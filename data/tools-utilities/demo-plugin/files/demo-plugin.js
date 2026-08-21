(function (root) {
  const plugin = {
    id: 'demo-plugin',
    name: 'Demo Plugin',
    description: 'A reference plugin for testing the RydR plugin manager.',
    version: '1.0.0',
    icon: '🧪',
    category: 'display',
    screensaverWidgets: [
      {
        id: 'demo-plugin-widget',
        label: 'Demo Widget',
        render: function (data) {
          const speed = Math.round(data && data.mph ? data.mph : 0);
          return `<div class="screensaver-widget" data-widget="demo-plugin-widget"><div class="screensaver-value screensaver-value-sm">${speed}</div><div class="screensaver-label">DEMO</div></div>`;
        },
        update: function (el, data) {
          const value = el.querySelector('.screensaver-value');
          if (value) value.textContent = Math.round(data && data.mph ? data.mph : 0);
        }
      }
    ],
    render: function (container, payload) {
      const telemetry = payload && payload.telemetry ? payload.telemetry : {};
      container.innerHTML = `
        <div class="plugin-surface">
          <div class="plugin-stat-row">
            <div class="plugin-big">${Math.round(telemetry.speed || 0)}<span>mph</span></div>
            <div class="plugin-chip">Demo</div>
          </div>
          <div class="plugin-meta-row">
            <div>
              <div class="plugin-label">Heading</div>
              <div class="plugin-value">${telemetry.heading || '—'}</div>
            </div>
            <div>
              <div class="plugin-label">Route</div>
              <div class="plugin-value">${telemetry.distance || '—'}</div>
            </div>
          </div>
          <div class="plugin-footer">
            <div>
              <div class="plugin-label">Weather</div>
              <div class="plugin-value">${telemetry.weather || '—'}</div>
            </div>
            <div>
              <div class="plugin-label">Status</div>
              <div class="plugin-value">${telemetry.isRecording ? 'Recording' : 'Ready'}</div>
            </div>
          </div>
        </div>
      `;
    }
  };

  const runtimeKey = '__RydRPluginRuntime__';
  root[runtimeKey] = root[runtimeKey] || {};
  root[runtimeKey][plugin.id] = plugin;
})(window);
