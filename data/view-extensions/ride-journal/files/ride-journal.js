(function (root) {
  const STORAGE_KEY = 'rydr_ext_ride_journal_v1';

  function getNotes() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch (e) {
      return [];
    }
  }

  function saveNotes(notes) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  }

  function renderScreen(container) {
    container.innerHTML = `
      <div class="plugin-surface" style="padding:20px;max-width:560px;margin:0 auto;">
        <h1 style="margin-bottom:12px;">Ride Journal</h1>
        <textarea id="journalInput" class="route-form" style="width:100%;min-height:80px;margin-bottom:8px;" placeholder="How was the ride?"></textarea>
        <button id="journalSaveBtn" class="btn" style="margin-bottom:16px;">Save entry</button>
        <div id="journalList"></div>
      </div>
    `;

    const list = container.querySelector('#journalList');
    function renderList() {
      const notes = getNotes();
      list.innerHTML = notes.length
        ? notes
            .slice()
            .reverse()
            .map(
              (n) =>
                `<div class="plugin-surface" style="margin-bottom:8px;padding:10px;">
                  <div class="plugin-label">${new Date(n.date).toLocaleString()}</div>
                  <div class="plugin-value" style="white-space:pre-wrap;">${n.text}</div>
                </div>`
            )
            .join('')
        : '<p class="plugin-label">No journal entries yet.</p>';
    }
    renderList();

    container.querySelector('#journalSaveBtn').addEventListener('click', () => {
      const input = container.querySelector('#journalInput');
      const text = input.value.trim();
      if (!text) return;
      const notes = getNotes();
      notes.push({ date: Date.now(), text });
      saveNotes(notes);
      input.value = '';
      renderList();
    });
  }

  const plugin = {
    id: 'ride-journal',
    name: 'Ride Journal',
    description: 'A freeform journal for jotting notes about a ride, in its own full-screen view.',
    version: '1.0.0',
    icon: '📓',
    category: 'tool',

    screen: {
      id: 'ride-journal-screen',
      title: 'Ride Journal',
      render: renderScreen,
    },
    menuItem: {
      id: 'ride-journal-menu-item',
      label: 'Ride Journal',
      icon: '📓',
      targetScreenId: 'ride-journal-screen',
    },
  };

  const runtimeKey = '__RydRPluginRuntime__';
  root[runtimeKey] = root[runtimeKey] || {};
  root[runtimeKey][plugin.id] = plugin;
})(window);
