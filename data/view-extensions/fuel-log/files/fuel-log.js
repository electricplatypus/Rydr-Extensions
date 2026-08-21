(function (root) {
  const STORAGE_KEY = 'rydr_ext_fuel_log_v1';

  function getEntries() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch (e) {
      return [];
    }
  }

  function saveEntries(entries) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  }

  function renderScreen(container) {
    const entries = getEntries();
    container.innerHTML = `
      <div class="plugin-surface" style="padding:20px;max-width:480px;margin:0 auto;">
        <h1 style="margin-bottom:12px;">Fuel Log</h1>
        <form id="fuelLogForm" style="display:flex;gap:8px;margin-bottom:16px;">
          <input id="fuelLogGallons" type="number" step="0.1" placeholder="Gallons" class="route-form" style="flex:1;" required />
          <input id="fuelLogCost" type="number" step="0.01" placeholder="Cost ($)" class="route-form" style="flex:1;" required />
          <button type="submit" class="btn">Add</button>
        </form>
        <div id="fuelLogList"></div>
      </div>
    `;

    const list = container.querySelector('#fuelLogList');
    function renderList() {
      const current = getEntries();
      list.innerHTML = current.length
        ? current
            .slice()
            .reverse()
            .map(
              (e) =>
                `<div class="plugin-surface" style="margin-bottom:8px;padding:10px;display:flex;justify-content:space-between;">
                  <span>${new Date(e.date).toLocaleDateString()}</span>
                  <span>${e.gallons} gal</span>
                  <span>$${Number(e.cost).toFixed(2)}</span>
                </div>`
            )
            .join('')
        : '<p class="plugin-label">No fuel entries yet.</p>';
    }
    renderList();

    container.querySelector('#fuelLogForm').addEventListener('submit', (event) => {
      event.preventDefault();
      const gallons = Number(container.querySelector('#fuelLogGallons').value);
      const cost = Number(container.querySelector('#fuelLogCost').value);
      if (!gallons || !cost) return;
      const entries = getEntries();
      entries.push({ date: Date.now(), gallons, cost });
      saveEntries(entries);
      event.target.reset();
      renderList();
    });
  }

  const plugin = {
    id: 'fuel-log',
    name: 'Fuel Log',
    description: 'Log fill-ups (gallons + cost) and browse fuel history in its own full-screen view.',
    version: '1.0.0',
    icon: '⛽',
    category: 'tool',

    screen: {
      id: 'fuel-log-screen',
      title: 'Fuel Log',
      render: renderScreen,
    },
    menuItem: {
      id: 'fuel-log-menu-item',
      label: 'Fuel Log',
      icon: '⛽',
      targetScreenId: 'fuel-log-screen',
    },
  };

  const runtimeKey = '__RydRPluginRuntime__';
  root[runtimeKey] = root[runtimeKey] || {};
  root[runtimeKey][plugin.id] = plugin;
})(window);
