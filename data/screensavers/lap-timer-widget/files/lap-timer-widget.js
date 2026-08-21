(function (root) {
  const plugin = {
    id: 'lap-timer-widget',
    name: 'Lap Timer',
    description: 'A flat OLED-friendly screensaver widget showing the current ride duration as a lap clock.',
    version: '1.0.0',
    icon: '⏱️',
    category: 'display',

    screensaverWidgets: [
      {
        id: 'lap-timer-widget',
        label: 'Lap Timer',
        render: function () {
          return '<div class="screensaver-widget" data-widget="lap-timer-widget"><div class="screensaver-value">00:00</div><div class="screensaver-label">LAP</div></div>';
        },
        update: function (el, data) {
          const seconds = Math.max(0, Math.round((data && data.rideSeconds) || 0));
          const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
          const ss = String(seconds % 60).padStart(2, '0');
          const value = el.querySelector('.screensaver-value');
          if (value) value.textContent = `${mm}:${ss}`;
        },
      },
    ],

    render: function (container) {
      container.innerHTML = '<div class="plugin-surface"><div class="plugin-label">Lap Timer runs from the screensaver only.</div></div>';
    },
  };

  const runtimeKey = '__RydRPluginRuntime__';
  root[runtimeKey] = root[runtimeKey] || {};
  root[runtimeKey][plugin.id] = plugin;
})(window);
