(function (root) {
  const plugin = {
    id: 'screensaver-example',
    name: 'Screensaver Example',
    description: 'Example plugin that adds a compact widget to RydR screensaver and dashboard cards.',
    version: '1.0.0',
    icon: '🖥️',
    category: 'display',
    screensaverWidgets: [
      {
        id: 'screensaver-example-widget',
        label: 'Screen Widget',
        render: function (data) {
          const mph = Math.round(data && data.mph ? data.mph : 0);
          return `<div class="screensaver-widget" data-widget="screensaver-example-widget"><div class="screensaver-value screensaver-value-sm">${mph}</div><div class="screensaver-label">EXAMPLE</div></div>`;
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
            <div class="plugin-chip">Example</div>
          </div>
          <div class="plugin-meta-row">
            <div>
              <div class="plugin-label">Heading</div>
              <div class="plugin-value">${telemetry.heading || '—'}</div>
            </div>
            <div>
              <div class="plugin-label">Status</div>
              <div class="plugin-value">${telemetry.isRecording ? 'Recording' : 'Idle'}</div>
            </div>
          </div>
          <div class="plugin-footer">
            <div>
              <div class="plugin-label">Weather</div>
              <div class="plugin-value">${telemetry.weather || '—'}</div>
            </div>
            <div>
              <div class="plugin-label">Route</div>
              <div class="plugin-value">${telemetry.distance || '—'}</div>
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
