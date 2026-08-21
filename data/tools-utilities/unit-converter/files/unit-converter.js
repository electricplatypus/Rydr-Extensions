(function (root) {
  const CONVERSIONS = {
    'mph-kmh': (v) => v * 1.60934,
    'kmh-mph': (v) => v / 1.60934,
    'mi-km': (v) => v * 1.60934,
    'km-mi': (v) => v / 1.60934,
    'gal-l': (v) => v * 3.78541,
    'l-gal': (v) => v / 3.78541,
  };

  const plugin = {
    id: 'unit-converter',
    name: 'Unit Converter',
    description: 'A quick speed/distance/volume unit converter dashboard card for imperial/metric riders.',
    version: '1.0.0',
    icon: '🔁',
    category: 'tool',

    render: function (container) {
      if (container.querySelector('.unit-converter-root')) return;

      container.innerHTML = `
        <div class="plugin-surface unit-converter-root" style="padding:12px;">
          <select id="ucMode" class="route-form" style="width:100%;margin-bottom:8px;">
            <option value="mph-kmh">mph → km/h</option>
            <option value="kmh-mph">km/h → mph</option>
            <option value="mi-km">mi → km</option>
            <option value="km-mi">km → mi</option>
            <option value="gal-l">gal → L</option>
            <option value="l-gal">L → gal</option>
          </select>
          <input id="ucInput" type="number" class="route-form" style="width:100%;margin-bottom:8px;" placeholder="Value" />
          <div class="plugin-big" id="ucResult">0</div>
        </div>
      `;

      const mode = container.querySelector('#ucMode');
      const input = container.querySelector('#ucInput');
      const result = container.querySelector('#ucResult');

      function update() {
        const value = Number(input.value) || 0;
        const fn = CONVERSIONS[mode.value];
        result.textContent = fn ? fn(value).toFixed(2) : '0';
      }

      mode.addEventListener('change', update);
      input.addEventListener('input', update);
      update();
    },
  };

  const runtimeKey = '__RydRPluginRuntime__';
  root[runtimeKey] = root[runtimeKey] || {};
  root[runtimeKey][plugin.id] = plugin;
})(window);
