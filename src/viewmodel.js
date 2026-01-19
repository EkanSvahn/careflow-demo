import ko from 'knockout';
import { fetchCases, saveCase } from './api.js';
import {
  PRIORITY_SLA_HOURS,
  PRIORITY_WEIGHT,
  formatDate,
  formatHours,
  hoursBetween,
} from './utils.js';

const STATUS_OPTIONS = ['Alla', 'Ny', 'Under utredning', 'Väntar', 'Pågående', 'Klar'];
const PRIORITY_OPTIONS = ['Alla', 'Hög', 'Medel', 'Låg'];
const SORT_OPTIONS = [
  { value: 'createdDesc', label: 'Senast inkomna' },
  { value: 'createdAsc', label: 'Äldst först' },
  { value: 'priorityDesc', label: 'Prioritet (hög först)' },
  { value: 'slaAsc', label: 'Kortast SLA kvar' },
];
const CATEGORY_OPTIONS = ['Onboarding', 'Fakturering', 'Behörighet', 'Incident', 'Teknik', 'Övrigt'];
const ASSIGNEE_OPTIONS = ['Ej tilldelad', 'Alex Kim', 'Maja Nilsson', 'Rami Åkesson', 'Supportteam'];
const FILTER_STORAGE_KEY = 'careflowFilters';
const CASES_STORAGE_KEY = 'careflowCases';

function createId(prefix) {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function CommentModel(data) {
  this.id = data.id ?? createId('c');
  this.author = data.author ?? 'Okänd';
  this.text = data.text ?? '';
  this.createdAt = data.createdAt ?? new Date().toISOString();
  this.createdLabel = ko.pureComputed(() => formatDate(new Date(this.createdAt)));
}

function HistoryModel(data) {
  this.id = data.id ?? createId('h');
  this.label = data.label ?? 'Uppdatering';
  this.createdAt = data.createdAt ?? new Date().toISOString();
  this.createdLabel = ko.pureComputed(() => formatDate(new Date(this.createdAt)));
}

function normalizeCaseData(data) {
  const createdAt = data.createdAt ?? new Date().toISOString();
  const history = Array.isArray(data.history) && data.history.length > 0
    ? data.history
    : [{ id: createId('h'), label: 'Ärende skapat', createdAt }];

  return {
    ...data,
    title: data.title ?? 'Nytt ärende',
    contactRef: data.contactRef ?? '',
    category: data.category ?? CATEGORY_OPTIONS[0],
    priority: data.priority ?? 'Medel',
    status: data.status ?? 'Ny',
    assignee: data.assignee ?? ASSIGNEE_OPTIONS[0],
    createdAt,
    comments: Array.isArray(data.comments) ? data.comments : [],
    history,
  };
}

function mergeCaseData(apiData, storedData) {
  if (!Array.isArray(storedData) || storedData.length === 0) {
    return apiData;
  }

  const apiById = new Map(apiData.map((item) => [item.id, item]));
  const merged = [];
  const seen = new Set();

  storedData.forEach((item) => {
    if (apiById.has(item.id)) {
      merged.push({ ...apiById.get(item.id), ...item });
      seen.add(item.id);
    } else {
      merged.push(item);
      seen.add(item.id);
    }
  });

  apiData.forEach((item) => {
    if (!seen.has(item.id)) {
      merged.push(item);
    }
  });

  return merged;
}

function CaseModel(data, nowTick) {
  const normalized = normalizeCaseData(data);

  this.id = normalized.id;
  this.title = ko.observable(normalized.title);
  this.contactRef = ko.observable(normalized.contactRef);
  this.category = ko.observable(normalized.category);
  this.priority = ko.observable(normalized.priority);
  this.status = ko.observable(normalized.status);
  this.assignee = ko.observable(normalized.assignee);
  this.createdAt = new Date(normalized.createdAt);
  this.comments = ko.observableArray(
    (normalized.comments ?? []).map((item) => new CommentModel(item)),
  );
  this.history = ko.observableArray(
    (normalized.history ?? []).map((item) => new HistoryModel(item)),
  );

  this.createdLabel = ko.pureComputed(() => formatDate(this.createdAt));

  this.slaHoursLeft = ko.pureComputed(() => {
    const now = nowTick();
    const slaHours = PRIORITY_SLA_HOURS[this.priority()] ?? 72;
    const elapsed = hoursBetween(this.createdAt.getTime(), now);
    return Math.round((slaHours - elapsed) * 10) / 10;
  });

  this.slaState = ko.pureComputed(() => {
    if (this.status() === 'Klar') return 'closed';
    const hoursLeft = this.slaHoursLeft();
    if (hoursLeft < 0) return 'overdue';
    if (hoursLeft < 8) return 'warning';
    return 'ok';
  });

  this.slaLabel = ko.pureComputed(() => {
    if (this.status() === 'Klar') {
      return 'Avslutad';
    }
    const hoursLeft = this.slaHoursLeft();
    if (hoursLeft < 0) {
      return `SLA överskriden med ${formatHours(hoursLeft)}`;
    }
    return `SLA kvar ${formatHours(hoursLeft)}`;
  });

  this.isOverdue = ko.pureComputed(() => this.slaState() === 'overdue');
  this.isWarning = ko.pureComputed(() => this.slaState() === 'warning');
  this.isClosed = ko.pureComputed(() => this.status() === 'Klar');
  this.hasComments = ko.pureComputed(() => this.comments().length > 0);
  this.hasHistory = ko.pureComputed(() => this.history().length > 0);
}

export function AppViewModel() {
  const nowTick = ko.observable(Date.now());
  setInterval(() => nowTick(Date.now()), 60 * 1000);

  this.cases = ko.observableArray([]);
  this.isLoading = ko.observable(false);
  this.errorMessage = ko.observable('');

  this.isSaving = ko.observable(false);
  this.saveMessage = ko.observable('');
  this.saveError = ko.observable('');
  this.lastSavedAt = ko.observable(null);

  this.query = ko.observable('');
  this.statusFilter = ko.observable('Alla');
  this.priorityFilter = ko.observable('Alla');
  this.sortBy = ko.observable('createdDesc');
  this.onlyOverdue = ko.observable(false);
  this.caseTab = ko.observable('open');

  this.simulateLoadError = ko.observable(false);
  this.simulateSaveError = ko.observable(false);

  this.statusOptions = STATUS_OPTIONS;
  this.priorityOptions = PRIORITY_OPTIONS;
  this.sortOptions = SORT_OPTIONS;
  this.categoryOptions = CATEGORY_OPTIONS;
  this.assigneeOptions = ASSIGNEE_OPTIONS;

  this.selectedCase = ko.observable(null);
  this.newCommentText = ko.observable('');
  this.newCommentAuthor = ko.observable('Du');
  this.isDrawerOpen = ko.pureComputed(() => Boolean(this.selectedCase()));
  this.lastSavedLabel = ko.pureComputed(() => {
    const savedAt = this.lastSavedAt();
    if (!savedAt) return 'Inte sparad ännu';
    return `Autosparad ${formatDate(savedAt)}`;
  });

  this.newCase = {
    title: ko.observable(''),
    contactRef: ko.observable(''),
    category: ko.observable(CATEGORY_OPTIONS[0]),
    priority: ko.observable('Medel'),
    status: ko.observable('Ny'),
    assignee: ko.observable(ASSIGNEE_OPTIONS[0]),
  };

  this.validationErrors = ko.observableArray([]);

  const toCasePayload = (item) => {
    const createdAt = item.createdAt instanceof Date
      ? item.createdAt.toISOString()
      : new Date(item.createdAt).toISOString();

    return {
      id: item.id,
      title: item.title(),
      contactRef: item.contactRef(),
      category: item.category(),
      priority: item.priority(),
      status: item.status(),
      assignee: item.assignee(),
      createdAt,
      comments: item.comments().map((comment) => ({
        id: comment.id,
        author: comment.author,
        text: comment.text,
        createdAt: comment.createdAt,
      })),
      history: item.history().map((entry) => ({
        id: entry.id,
        label: entry.label,
        createdAt: entry.createdAt,
      })),
    };
  };

  const persistCases = () => {
    try {
      const payload = this.cases().map((item) => toCasePayload(item));
      localStorage.setItem(CASES_STORAGE_KEY, JSON.stringify(payload));
      this.lastSavedAt(new Date());
    } catch (error) {
      // Ignore storage errors (private mode etc.)
    }
  };

  const loadStoredCases = () => {
    try {
      const raw = localStorage.getItem(CASES_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch (error) {
      return null;
    }
  };

  const addHistoryEntry = (item, label) => {
    item.history.unshift(
      new HistoryModel({
        id: createId('h'),
        label,
        createdAt: new Date().toISOString(),
      }),
    );
  };

  const trackCase = (item) => {
    item.status.subscribe((value) => {
      addHistoryEntry(item, `Status ändrad till ${value}`);
      persistCases();
    });
    item.priority.subscribe((value) => {
      addHistoryEntry(item, `Prioritet satt till ${value}`);
      persistCases();
    });
    item.assignee.subscribe((value) => {
      addHistoryEntry(item, `Tilldelad: ${value}`);
      persistCases();
    });
    item.category.subscribe((value) => {
      addHistoryEntry(item, `Kategori ändrad till ${value}`);
      persistCases();
    });
    item.title.subscribe(() => persistCases());
    item.contactRef.subscribe(() => persistCases());
    item.comments.subscribe(() => persistCases());
  };

  this.totalCount = ko.pureComputed(() => this.cases().length);
  this.openCount = ko.pureComputed(() => this.cases().filter((item) => item.status() !== 'Klar').length);
  this.overdueCount = ko.pureComputed(() => this.cases().filter((item) => item.isOverdue()).length);

  this.activeFiltersCount = ko.pureComputed(() => {
    let count = 0;
    if (this.query().trim()) count += 1;
    if (this.statusFilter() !== 'Alla') count += 1;
    if (this.priorityFilter() !== 'Alla') count += 1;
    if (this.onlyOverdue()) count += 1;
    return count;
  });

  this.hasActiveFilters = ko.pureComputed(() => this.activeFiltersCount() > 0);

  this.activeFiltersLabel = ko.pureComputed(() => {
    const count = this.activeFiltersCount();
    if (count === 0) return 'Inga aktiva filter';
    return `${count} aktiva filter`;
  });

  this.filteredCases = ko.pureComputed(() => {
    const query = this.query().trim().toLowerCase();
    const statusFilter = this.statusFilter();
    const priorityFilter = this.priorityFilter();
    const onlyOverdue = this.onlyOverdue();
    const sortBy = this.sortBy();

    let items = this.cases();

    if (query) {
      items = items.filter((item) => {
        const haystack = [
          item.id,
          item.title(),
          item.contactRef(),
          item.category(),
          item.assignee(),
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(query);
      });
    }

    if (statusFilter !== 'Alla') {
      items = items.filter((item) => item.status() === statusFilter);
    }

    if (priorityFilter !== 'Alla') {
      items = items.filter((item) => item.priority() === priorityFilter);
    }

    if (onlyOverdue) {
      items = items.filter((item) => item.isOverdue());
    }

    const sorted = [...items];

    sorted.sort((a, b) => {
      switch (sortBy) {
        case 'createdAsc':
          return a.createdAt.getTime() - b.createdAt.getTime();
        case 'priorityDesc':
          return (PRIORITY_WEIGHT[b.priority()] ?? 0) - (PRIORITY_WEIGHT[a.priority()] ?? 0);
        case 'slaAsc':
          return a.slaHoursLeft() - b.slaHoursLeft();
        case 'createdDesc':
        default:
          return b.createdAt.getTime() - a.createdAt.getTime();
      }
    });

    return sorted;
  });

  this.filteredOpenCases = ko.pureComputed(() =>
    this.filteredCases().filter((item) => item.status() !== 'Klar'),
  );

  this.filteredDoneCases = ko.pureComputed(() =>
    this.filteredCases().filter((item) => item.status() === 'Klar'),
  );

  this.visibleCases = ko.pureComputed(() =>
    this.caseTab() === 'done' ? this.filteredDoneCases() : this.filteredOpenCases(),
  );

  this.visibleCasesTitle = ko.pureComputed(() =>
    this.caseTab() === 'done' ? 'Avslutade ärenden' : 'Aktiva ärenden',
  );

  this.visibleEmptyLabel = ko.pureComputed(() =>
    this.caseTab() === 'done'
      ? 'Inga avslutade ärenden matchar filtret just nu.'
      : 'Inga aktiva ärenden matchar filtret just nu.',
  );

  this.openCase = (item) => {
    this.selectedCase(item);
    this.newCommentText('');
  };

  this.closeCase = () => {
    this.selectedCase(null);
    this.newCommentText('');
  };

  this.addComment = () => {
    const activeCase = this.selectedCase();
    const text = this.newCommentText().trim();
    if (!activeCase || !text) return;

    const comment = new CommentModel({
      id: createId('c'),
      author: this.newCommentAuthor(),
      text,
      createdAt: new Date().toISOString(),
    });

    activeCase.comments.unshift(comment);
    addHistoryEntry(activeCase, 'Kommentar tillagd');
    this.newCommentText('');
    persistCases();
  };

  this.markSelectedAsDone = () => {
    const activeCase = this.selectedCase();
    if (!activeCase) return;
    activeCase.status('Klar');
  };

  this.setCaseTab = (tab) => {
    if (tab === 'open' || tab === 'done') {
      this.caseTab(tab);
    }
  };

  this.resetFilters = () => {
    this.query('');
    this.statusFilter('Alla');
    this.priorityFilter('Alla');
    this.sortBy('createdDesc');
    this.onlyOverdue(false);
  };

  this.persistFilters = () => {
    const payload = {
      query: this.query(),
      statusFilter: this.statusFilter(),
      priorityFilter: this.priorityFilter(),
      sortBy: this.sortBy(),
      onlyOverdue: this.onlyOverdue(),
    };

    try {
      localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      // Ignore storage errors (private mode etc.)
    }
  };

  this.restoreFilters = () => {
    try {
      const raw = localStorage.getItem(FILTER_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (typeof parsed.query === 'string') this.query(parsed.query);
      if (typeof parsed.statusFilter === 'string') this.statusFilter(parsed.statusFilter);
      if (typeof parsed.priorityFilter === 'string') this.priorityFilter(parsed.priorityFilter);
      if (typeof parsed.sortBy === 'string') this.sortBy(parsed.sortBy);
      if (typeof parsed.onlyOverdue === 'boolean') this.onlyOverdue(parsed.onlyOverdue);
    } catch (error) {
      // Ignore invalid storage data
    }
  };

  this.validationMessage = ko.pureComputed(() => {
    if (this.validationErrors().length === 0) return '';
    return 'Åtgärda felen innan du sparar.';
  });

  this.validateForm = () => {
    const errors = [];
    const title = this.newCase.title().trim();
    const contactRef = this.newCase.contactRef().trim();

    if (title.length < 4) {
      errors.push('Titel måste vara minst 4 tecken.');
    }
    if (!contactRef) {
      errors.push('Kontaktref krävs (använd pseudonym).');
    }
    if (!this.newCase.category()) {
      errors.push('Välj en kategori.');
    }
    if (!this.newCase.priority()) {
      errors.push('Välj en prioritet.');
    }

    this.validationErrors(errors);
    return errors.length === 0;
  };

  this.resetForm = () => {
    this.newCase.title('');
    this.newCase.contactRef('');
    this.newCase.category(CATEGORY_OPTIONS[0]);
    this.newCase.priority('Medel');
    this.newCase.status('Ny');
    this.newCase.assignee(ASSIGNEE_OPTIONS[0]);
    this.validationErrors([]);
  };

  this.saveNewCase = async () => {
    this.saveMessage('');
    this.saveError('');

    if (!this.validateForm()) {
      return false;
    }

    this.isSaving(true);

    try {
      const payload = {
        title: this.newCase.title().trim(),
        contactRef: this.newCase.contactRef().trim(),
        category: this.newCase.category(),
        priority: this.newCase.priority(),
        status: this.newCase.status(),
        assignee: this.newCase.assignee(),
        createdAt: new Date().toISOString(),
      };

      const saved = await saveCase(payload, { fail: this.simulateSaveError() });
      const mapped = new CaseModel(saved, nowTick);
      trackCase(mapped);
      this.cases.unshift(mapped);
      persistCases();
      this.saveMessage('Ärendet sparades och lades till i listan.');
      this.resetForm();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Okänt fel vid sparande.';
      this.saveError(message);
    } finally {
      this.isSaving(false);
    }

    return false;
  };

  this.reloadCases = async () => {
    this.isLoading(true);
    this.errorMessage('');

    try {
      const data = await fetchCases({ fail: this.simulateLoadError() });
      const stored = loadStoredCases();
      const merged = mergeCaseData(data, stored ?? []);
      const mapped = merged.map((item) => new CaseModel(item, nowTick));
      mapped.forEach((item) => trackCase(item));
      this.cases(mapped);
      this.selectedCase(null);
      if (merged.length > 0) {
        persistCases();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Okänt fel vid laddning.';
      this.errorMessage(message);
    } finally {
      this.isLoading(false);
    }
  };

  const filterObservables = [
    this.query,
    this.statusFilter,
    this.priorityFilter,
    this.sortBy,
    this.onlyOverdue,
  ];

  filterObservables.forEach((observable) => {
    observable.subscribe(() => this.persistFilters());
  });

  this.restoreFilters();
  this.reloadCases();
}
