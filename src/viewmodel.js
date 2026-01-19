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

function CaseModel(data, nowTick) {
  this.id = data.id;
  this.title = ko.observable(data.title);
  this.contactRef = ko.observable(data.contactRef);
  this.category = ko.observable(data.category);
  this.priority = ko.observable(data.priority);
  this.status = ko.observable(data.status);
  this.assignee = ko.observable(data.assignee);
  this.createdAt = new Date(data.createdAt);

  this.createdLabel = ko.pureComputed(() => formatDate(this.createdAt));

  this.slaHoursLeft = ko.pureComputed(() => {
    const now = nowTick();
    const slaHours = PRIORITY_SLA_HOURS[this.priority()] ?? 72;
    const elapsed = hoursBetween(this.createdAt.getTime(), now);
    return Math.round((slaHours - elapsed) * 10) / 10;
  });

  this.slaState = ko.pureComputed(() => {
    const hoursLeft = this.slaHoursLeft();
    if (hoursLeft < 0) return 'overdue';
    if (hoursLeft < 8) return 'warning';
    return 'ok';
  });

  this.slaLabel = ko.pureComputed(() => {
    const hoursLeft = this.slaHoursLeft();
    if (hoursLeft < 0) {
      return `SLA överskriden med ${formatHours(hoursLeft)}`;
    }
    return `SLA kvar ${formatHours(hoursLeft)}`;
  });

  this.isOverdue = ko.pureComputed(() => this.slaState() === 'overdue');
  this.isWarning = ko.pureComputed(() => this.slaState() === 'warning');
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

  this.query = ko.observable('');
  this.statusFilter = ko.observable('Alla');
  this.priorityFilter = ko.observable('Alla');
  this.sortBy = ko.observable('createdDesc');
  this.onlyOverdue = ko.observable(false);

  this.simulateLoadError = ko.observable(false);
  this.simulateSaveError = ko.observable(false);

  this.statusOptions = STATUS_OPTIONS;
  this.priorityOptions = PRIORITY_OPTIONS;
  this.sortOptions = SORT_OPTIONS;
  this.categoryOptions = CATEGORY_OPTIONS;
  this.assigneeOptions = ASSIGNEE_OPTIONS;

  this.newCase = {
    title: ko.observable(''),
    contactRef: ko.observable(''),
    category: ko.observable(CATEGORY_OPTIONS[0]),
    priority: ko.observable('Medel'),
    status: ko.observable('Ny'),
    assignee: ko.observable(ASSIGNEE_OPTIONS[0]),
  };

  this.validationErrors = ko.observableArray([]);

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
      localStorage.setItem('careflowFilters', JSON.stringify(payload));
    } catch (error) {
      // Ignore storage errors (private mode etc.)
    }
  };

  this.restoreFilters = () => {
    try {
      const raw = localStorage.getItem('careflowFilters');
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
      this.cases.unshift(new CaseModel(saved, nowTick));
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
      const mapped = data.map((item) => new CaseModel(item, nowTick));
      this.cases(mapped);
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
