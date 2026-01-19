import './style.css';
import ko from 'knockout';
import { AppViewModel } from './viewmodel.js';

ko.options.deferUpdates = true;

const root = document.getElementById('app');
const viewModel = new AppViewModel();

ko.applyBindings(viewModel, root);
