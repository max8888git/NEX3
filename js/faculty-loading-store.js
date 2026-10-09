(function (global) {
  'use strict';

  if (global.FacultyLoadingStore) return;

  function load() {
    if (!global.McuApi) return Promise.reject(new Error('Faculty loading needs the server.'));
    return global.McuApi.get('faculty-loading.php');
  }

  function save(body) {
    body.action = 'save';
    return global.McuApi.send('POST', 'faculty-loading.php', body);
  }

  function act(action, id, note) {
    return global.McuApi.send('POST', 'faculty-loading.php', {
      action: action,
      id: id,
      note: note || ''
    });
  }

  function clear() {
    return global.McuApi.send('POST', 'faculty-loading.php', { action: 'clear' });
  }

  global.FacultyLoadingStore = {
    load: load,
    save: save,
    act: act,
    clear: clear
  };
})(typeof window !== 'undefined' ? window : this);
