// Native notification delivery and modal choices are OS boundaries. Everything
// else, including windows, IPC, task state and disk writes, runs unchanged.
const { Notification, dialog } = require('electron');
global.__tasktickAlerts = [];
Notification.prototype.show = function () {
  global.__tasktickAlerts.push({ title: this.title, body: this.body });
};
dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
require('../dist/main/index.js');
