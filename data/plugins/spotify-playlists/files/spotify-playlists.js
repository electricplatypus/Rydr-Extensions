(function (root) {
  // Local state to prevent DOM thrashing and preserve scroll position
  let state = {
    connected: false,
    loading: false,
    loaded: false,
    playlists: [],
    container: null,
    unsubSpotify: null,
    lastPrefsString: '',
    lastViewPrefsString: ''
  };

  const SORT_OPTIONS = [
    { value: 'default', label: 'Default' },
    { value: 'alpha', label: 'A–Z' },
    { value: 'tracks', label: 'Most Tracks' },
    { value: 'recent', label: 'Recently Played' }
  ];

  function getSpotify() {
    return root.RydRSpotify || window.RydRSpotify || (typeof RydRSpotify !== 'undefined' ? RydRSpotify : null);
  }

  const plugin = {
    id: 'spotify-playlists',
    name: 'Spotify Playlists',
    description: 'Browse your Spotify playlists as a list or a thumbnail grid, with sort and quick-play.',
    version: '1.2.0',
    icon: '🎵',
    category: 'media',

    render: function (container, payload) {
      state.container = container;
      const spotify = getSpotify();
      const isConnected = !!(spotify && typeof spotify.getState === 'function' && spotify.getState().connected);

      // Handle disconnected state
      if (!spotify || !isConnected) {
        state.loaded = false;
        state.playlists = [];
        state.lastPrefsString = '';
        state.lastViewPrefsString = '';
        if (!container.querySelector('.sp-disconnected')) {
          renderDisconnected(container, spotify);
        }
        return;
      }

      const viewPrefs = typeof spotify.getPlaylistViewPrefs === 'function' ? spotify.getPlaylistViewPrefs() : { mode: 'thumbnail', columns: 2 };
      const viewPrefsStr = JSON.stringify(viewPrefs);
      const viewChanged = !!state.lastViewPrefsString && viewPrefsStr !== state.lastViewPrefsString;
      state.lastViewPrefsString = viewPrefsStr;

      // Check if user changed playlist settings or sort order in Settings modal
      let prefsChanged = false;
      if (typeof spotify.getPlaylistPreferences === 'function') {
        const prefsStr = JSON.stringify(spotify.getPlaylistPreferences() || {});
        if (state.loaded && state.lastPrefsString && prefsStr !== state.lastPrefsString) {
          prefsChanged = true;
        }
        state.lastPrefsString = prefsStr;
      }

      // Ensure main wrapper DOM structure exists (only rebuild when the
      // view mode itself changes shape — list vs. grid need different
      // markup, not just different CSS).
      let wrapper = container.querySelector('.sp-playlists-wrapper');
      if (!wrapper || viewChanged) {
        renderWrapper(container, spotify, viewPrefs);
        wrapper = container.querySelector('.sp-playlists-wrapper');
        // Redraw whatever's already fetched in the new layout immediately
        // instead of waiting on a fresh network round trip.
        if (wrapper && state.loaded && state.playlists.length && !prefsChanged) {
          renderItems(wrapper, state.playlists, viewPrefs);
        }
      } else {
        applyColumns(wrapper, viewPrefs);
      }

      // The sort <select> only gets its initial value at wrapper-build
      // time — if the sort preference changes elsewhere (the Settings >
      // Spotify Playlists tab) without a view-mode change, the wrapper
      // itself isn't rebuilt, so without this the plugin's own dropdown
      // would silently drift out of sync with the preference it's
      // supposed to reflect.
      if (wrapper && typeof spotify.getPlaylistPreferences === 'function') {
        const sortSelect = wrapper.querySelector('#spSortSelect');
        if (sortSelect && document.activeElement !== sortSelect) {
          sortSelect.value = (spotify.getPlaylistPreferences().sort) || 'default';
        }
      }

      // Check current active track context if available
      const spotifyState = spotify.getState();
      const currentTrack = spotifyState && spotifyState.nowPlaying;
      if (wrapper) {
        updateActiveHighlight(wrapper, currentTrack);
      }

      // Fetch playlists ONCE on load, or on user settings change / refresh button click
      if ((!state.loaded || prefsChanged) && !state.loading) {
        fetchPlaylists(wrapper, spotify, false, viewPrefs);
      }

      // Subscribe to Spotify state updates for smooth, real-time track highlight updates
      if (!state.unsubSpotify && spotify && typeof spotify.subscribe === 'function') {
        state.unsubSpotify = spotify.subscribe((s) => {
          if (state.container) {
            const w = state.container.querySelector('.sp-playlists-wrapper');
            if (w) updateActiveHighlight(w, s.nowPlaying);
          }
        });
      }
    }
  };

  function renderDisconnected(container, spotify) {
    container.innerHTML = `
      <div class="sp-plugin-surface sp-disconnected">
        <div class="sp-icon-large">🎵</div>
        <div class="sp-subtitle">Connect Spotify to view your playlists and play them directly.</div>
        <button type="button" class="sp-connect-btn" id="spConnectBtn">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.899 4.62-1.02 8.52-.6 11.64 1.32.36.18.48.66.3.102zm1.48-3.3c-.3.48-.9.66-1.38.36-3.24-1.98-8.16-2.58-11.94-1.44-.54.18-1.14-.12-1.32-.66-.18-.54.12-1.14.66-1.32 4.32-1.32 9.78-.66 13.56 1.68.48.3.66.9.42 1.38zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.18-1.26-.18-1.44-.78-.18-.6.18-1.26.78-1.44 4.26-1.26 11.28-1.02 15.72 1.62.54.3.72.96.42 1.5-.3.54-.96.72-1.5.42z"/></svg>
          Connect Spotify
        </button>
      </div>
    `;
    const btn = container.querySelector('#spConnectBtn');
    if (btn) {
      btn.addEventListener('click', () => {
        const activeSpotify = getSpotify();
        if (activeSpotify && typeof activeSpotify.connect === 'function') {
          activeSpotify.connect();
        }
      });
    }
  }

  function renderWrapper(container, spotify, viewPrefs) {
    const isList = viewPrefs.mode === 'list';
    container.innerHTML = `
      <style>
        .sp-plugin-surface {
          --scale: var(--plugin-scale, 1);
          --sp-cols: 2;
          display: flex;
          flex-direction: column;
          width: 100%;
          height: 100%;
          min-height: calc(220px * var(--scale));
          background: linear-gradient(145deg, rgba(18, 18, 18, 0.95), rgba(28, 28, 30, 0.95));
          border-radius: calc(12px * var(--scale));
          padding: calc(10px * var(--scale));
          box-sizing: border-box;
          color: #ffffff;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          position: relative;
          overflow: hidden;
          user-select: none;
        }
        .sp-disconnected {
          align-items: center;
          justify-content: center;
          text-align: center;
          padding: calc(20px * var(--scale)) calc(14px * var(--scale));
        }
        .sp-icon-large {
          font-size: calc(30px * var(--scale));
          margin-bottom: calc(6px * var(--scale));
        }
        .sp-subtitle {
          font-size: calc(11px * var(--scale));
          color: rgba(255, 255, 255, 0.6);
          max-width: calc(220px * var(--scale));
          margin-bottom: calc(14px * var(--scale));
          line-height: 1.4;
        }
        .sp-connect-btn {
          display: inline-flex;
          align-items: center;
          gap: calc(8px * var(--scale));
          background: #1db954;
          color: #000000;
          border: none;
          font-weight: 700;
          font-size: calc(12px * var(--scale));
          padding: calc(8px * var(--scale)) calc(16px * var(--scale));
          border-radius: calc(20px * var(--scale));
          cursor: pointer;
          transition: transform 0.15s, background 0.15s;
        }
        .sp-connect-btn:hover {
          background: #1ed760;
          transform: scale(1.04);
        }

        /* Plugin Header */
        .sp-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: calc(6px * var(--scale));
          margin-bottom: calc(8px * var(--scale));
          padding: 0 calc(2px * var(--scale));
        }
        .sp-header-left {
          display: flex;
          align-items: center;
          gap: calc(6px * var(--scale));
          font-size: calc(13px * var(--scale));
          font-weight: 700;
          flex-shrink: 0;
        }
        .sp-header-count {
          font-size: calc(10px * var(--scale));
          background: rgba(255, 255, 255, 0.1);
          color: rgba(255, 255, 255, 0.7);
          padding: 2px 6px;
          border-radius: 10px;
          font-weight: 600;
        }
        .sp-header-controls {
          display: flex;
          align-items: center;
          gap: calc(6px * var(--scale));
          min-width: 0;
        }
        .sp-sort-select {
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.12);
          color: #fff;
          font-size: calc(10.5px * var(--scale));
          font-weight: 600;
          border-radius: 999px;
          padding: calc(3px * var(--scale)) calc(8px * var(--scale));
          height: calc(26px * var(--scale));
          min-width: 0;
          cursor: pointer;
        }
        .sp-nav-btn {
          background: rgba(255, 255, 255, 0.08);
          border: none;
          color: #fff;
          width: calc(26px * var(--scale));
          height: calc(26px * var(--scale));
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: background 0.2s, transform 0.1s;
          font-size: calc(14px * var(--scale));
          flex-shrink: 0;
        }
        .sp-nav-btn:hover {
          background: rgba(29, 185, 84, 0.4);
          color: #1db954;
        }
        .sp-nav-btn:active {
          transform: scale(0.92);
        }
        .sp-nav-btn:disabled {
          opacity: 0.3;
          cursor: not-allowed;
        }
        .sp-nav-btn.sp-spinning {
          animation: sp-spin 0.8s linear infinite;
        }
        .sp-nav-btn.sp-active {
          background: rgba(29, 185, 84, 0.4);
          color: #1db954;
        }

        /* Viewport & Grid Container (thumbnail mode) */
        .sp-playlists-viewport {
          position: relative;
          flex: 1;
          width: 100%;
          display: flex;
          align-items: center;
          overflow: hidden;
        }
        .sp-side-arrow {
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          z-index: 10;
          background: rgba(0, 0, 0, 0.75);
          border: 1px solid rgba(255, 255, 255, 0.15);
          color: #fff;
          width: calc(30px * var(--scale));
          height: calc(30px * var(--scale));
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          box-shadow: 0 4px 12px rgba(0,0,0,0.5);
          transition: all 0.2s ease;
          backdrop-filter: blur(4px);
          font-size: calc(14px * var(--scale));
        }
        .sp-side-arrow:hover {
          background: #1db954;
          color: #000;
          border-color: #1db954;
          transform: translateY(-50%) scale(1.1);
        }
        .sp-side-arrow-left { left: calc(4px * var(--scale)); }
        .sp-side-arrow-right { right: calc(4px * var(--scale)); }

        /* 2-high grid; --sp-cols visible columns per page before it
           slides over (set from Settings > Spotify Playlists > Views). */
        .sp-grid {
          display: grid;
          grid-template-rows: repeat(2, 1fr);
          grid-auto-flow: column;
          grid-auto-columns: calc((100% - (var(--sp-cols) - 1) * (8px * var(--scale))) / var(--sp-cols));
          gap: calc(8px * var(--scale));
          width: 100%;
          height: 100%;
          overflow-x: auto;
          overflow-y: hidden;
          scroll-snap-type: x mandatory;
          scroll-behavior: smooth;
          -webkit-overflow-scrolling: touch;
          padding: 2px;
          box-sizing: border-box;
        }
        .sp-grid::-webkit-scrollbar { height: 4px; }
        .sp-grid::-webkit-scrollbar-track { background: rgba(255, 255, 255, 0.05); border-radius: 2px; }
        .sp-grid::-webkit-scrollbar-thumb { background: rgba(29, 185, 84, 0.4); border-radius: 2px; }

        /* Individual Playlist Card (thumbnail mode) */
        .sp-card {
          scroll-snap-align: start;
          display: flex;
          flex-direction: row;
          align-items: center;
          gap: calc(8px * var(--scale));
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: calc(8px * var(--scale));
          padding: calc(6px * var(--scale));
          cursor: pointer;
          transition: all 0.2s ease;
          box-sizing: border-box;
          position: relative;
          overflow: hidden;
          height: 100%;
          min-height: calc(54px * var(--scale));
        }
        .sp-card:hover {
          background: rgba(255, 255, 255, 0.1);
          border-color: rgba(29, 185, 84, 0.5);
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
        }
        .sp-card:active { transform: scale(0.98); }
        .sp-card.sp-playing {
          border-color: #1db954;
          background: rgba(29, 185, 84, 0.15);
          box-shadow: 0 0 12px rgba(29, 185, 84, 0.3);
        }
        .sp-thumb {
          width: calc(44px * var(--scale));
          height: calc(44px * var(--scale));
          min-width: calc(44px * var(--scale));
          border-radius: calc(6px * var(--scale));
          object-fit: cover;
          background: #282828;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: calc(18px * var(--scale));
          color: rgba(255, 255, 255, 0.3);
          box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        }
        .sp-card-info { display: flex; flex-direction: column; justify-content: center; overflow: hidden; flex: 1; }
        .sp-card-title {
          font-size: calc(11px * var(--scale));
          font-weight: 600;
          color: #ffffff;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          line-height: 1.3;
        }
        .sp-card-meta {
          font-size: calc(10px * var(--scale));
          color: rgba(255, 255, 255, 0.5);
          margin-top: 2px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .sp-play-badge {
          display: none;
          align-items: center;
          justify-content: center;
          color: #1db954;
          font-size: calc(12px * var(--scale));
          margin-left: 4px;
        }
        .sp-card.sp-playing .sp-play-badge { display: flex; }

        /* List mode */
        .sp-list {
          display: flex;
          flex-direction: column;
          gap: calc(4px * var(--scale));
          width: 100%;
          /* Exactly 4 rows tall (4 * item height + 3 gaps between them) —
             scroll vertically for the rest instead of growing to fit
             every playlist, which is what flex:1 used to do. */
          height: calc((4 * 44px + 3 * 4px) * var(--scale));
          flex: none;
          overflow-y: auto;
          box-sizing: border-box;
          padding: 2px;
        }
        .sp-list::-webkit-scrollbar { width: 4px; }
        .sp-list::-webkit-scrollbar-track { background: rgba(255, 255, 255, 0.05); border-radius: 2px; }
        .sp-list::-webkit-scrollbar-thumb { background: rgba(29, 185, 84, 0.4); border-radius: 2px; }
        .sp-list-item {
          display: flex;
          align-items: center;
          gap: calc(10px * var(--scale));
          width: 100%;
          min-height: calc(44px * var(--scale));
          padding: calc(6px * var(--scale));
          border-radius: calc(8px * var(--scale));
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.08);
          cursor: pointer;
          box-sizing: border-box;
          transition: all 0.15s ease;
        }
        .sp-list-item:hover { background: rgba(255, 255, 255, 0.1); border-color: rgba(29, 185, 84, 0.5); }
        .sp-list-item.sp-playing {
          border-color: #1db954;
          background: rgba(29, 185, 84, 0.15);
          box-shadow: 0 0 12px rgba(29, 185, 84, 0.2);
        }
        .sp-list-thumb {
          width: calc(36px * var(--scale));
          height: calc(36px * var(--scale));
          min-width: calc(36px * var(--scale));
          border-radius: calc(6px * var(--scale));
          object-fit: cover;
          background: #282828;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: calc(15px * var(--scale));
          color: rgba(255, 255, 255, 0.3);
        }
        .sp-list-info { flex: 1; overflow: hidden; }
        .sp-list-title {
          font-size: calc(12px * var(--scale));
          font-weight: 600;
          color: #ffffff;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .sp-list-meta {
          font-size: calc(10px * var(--scale));
          color: rgba(255, 255, 255, 0.5);
          margin-top: 2px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        /* Loading & Empty states */
        .sp-loading-container, .sp-empty-container {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          height: 100%;
          color: rgba(255, 255, 255, 0.5);
          font-size: 13px;
          gap: 8px;
        }
        .sp-spinner {
          width: 18px;
          height: 18px;
          border: 2px solid rgba(255, 255, 255, 0.2);
          border-top-color: #1db954;
          border-radius: 50%;
          animation: sp-spin 0.8s linear infinite;
        }
        @keyframes sp-spin { to { transform: rotate(360deg); } }
      </style>
      <div class="sp-plugin-surface sp-playlists-wrapper" data-mode="${isList ? 'list' : 'thumbnail'}">
        <div class="sp-header">
          <div class="sp-header-left">
            <span>🎵</span>
            <span class="sp-header-count" id="spPlaylistCount">0</span>
          </div>
          <div class="sp-header-controls">
            <select class="sp-sort-select" id="spSortSelect" title="Sort by" aria-label="Sort playlists by">
              ${SORT_OPTIONS.map((o) => `<option value="${o.value}">${o.label}</option>`).join('')}
            </select>
            <button type="button" class="sp-nav-btn" id="spViewToggleBtn" title="${isList ? 'Switch to thumbnail view' : 'Switch to list view'}" aria-label="Switch view">${isList ? '▦' : '☰'}</button>
            <button type="button" class="sp-nav-btn" id="spRefreshBtn" title="Refresh Playlists" aria-label="Refresh playlists">↻</button>
            ${isList ? '' : `
              <button type="button" class="sp-nav-btn" id="spNavPrev" title="Scroll Left" aria-label="Scroll left">‹</button>
              <button type="button" class="sp-nav-btn" id="spNavNext" title="Scroll Right" aria-label="Scroll right">›</button>
            `}
          </div>
        </div>
        ${isList
          ? `<div class="sp-list" id="spList">
              <div class="sp-loading-container"><div class="sp-spinner"></div><span>Loading playlists...</span></div>
            </div>`
          : `<div class="sp-playlists-viewport">
              <button type="button" class="sp-side-arrow sp-side-arrow-left" id="spArrowLeft" aria-label="Previous Playlists">‹</button>
              <div class="sp-grid" id="spGrid">
                <div class="sp-loading-container"><div class="sp-spinner"></div><span>Loading playlists...</span></div>
              </div>
              <button type="button" class="sp-side-arrow sp-side-arrow-right" id="spArrowRight" aria-label="Next Playlists">›</button>
            </div>`
        }
      </div>
    `;

    const wrapper = container.querySelector('.sp-playlists-wrapper');
    applyColumns(wrapper, viewPrefs);
    attachControls(wrapper, spotify, viewPrefs);
  }

  function applyColumns(wrapper, viewPrefs) {
    if (!wrapper) return;
    wrapper.style.setProperty('--sp-cols', String(viewPrefs.columns || 2));
  }

  function attachControls(wrapper, spotify, viewPrefs) {
    if (!wrapper) return;
    const isList = viewPrefs.mode === 'list';
    const grid = wrapper.querySelector('#spGrid');
    const list = wrapper.querySelector('#spList');
    const refreshBtn = wrapper.querySelector('#spRefreshBtn');
    const prevBtn = wrapper.querySelector('#spNavPrev');
    const nextBtn = wrapper.querySelector('#spNavNext');
    const arrowLeft = wrapper.querySelector('#spArrowLeft');
    const arrowRight = wrapper.querySelector('#spArrowRight');
    const sortSelect = wrapper.querySelector('#spSortSelect');
    const viewToggleBtn = wrapper.querySelector('#spViewToggleBtn');

    if (sortSelect) {
      const prefs = typeof spotify.getPlaylistPreferences === 'function' ? spotify.getPlaylistPreferences() : { sort: 'default' };
      sortSelect.value = prefs.sort || 'default';
      sortSelect.addEventListener('change', (e) => {
        e.stopPropagation();
        if (typeof spotify.setPlaylistPreferences === 'function') {
          spotify.setPlaylistPreferences({ sort: sortSelect.value });
        }
        // The dashboard's plugin framework only re-renders plugin cards
        // on its own 2s poll tick — forcing render() directly here is
        // what makes this dropdown feel instant instead of laggy.
        if (state.container) plugin.render(state.container, {});
      });
      sortSelect.addEventListener('click', (e) => e.stopPropagation());
    }

    if (viewToggleBtn) {
      viewToggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof spotify.setPlaylistViewPrefs === 'function') {
          spotify.setPlaylistViewPrefs({ mode: isList ? 'thumbnail' : 'list' });
        }
        if (state.container) plugin.render(state.container, {});
      });
    }

    // Refresh icon button listener: re-fetches playlists from Spotify API on user click
    if (refreshBtn) {
      refreshBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        refreshBtn.classList.add('sp-spinning');
        state.loaded = false;
        fetchPlaylists(wrapper, spotify, true, viewPrefs).then(() => {
          refreshBtn.classList.remove('sp-spinning');
        });
      });
    }

    if (!isList) {
      const scrollPage = (direction) => {
        if (!grid) return;
        const scrollAmount = grid.clientWidth;
        grid.scrollBy({ left: direction * scrollAmount, behavior: 'smooth' });
      };
      if (prevBtn) prevBtn.addEventListener('click', () => scrollPage(-1));
      if (nextBtn) nextBtn.addEventListener('click', () => scrollPage(1));
      if (arrowLeft) arrowLeft.addEventListener('click', () => scrollPage(-1));
      if (arrowRight) arrowRight.addEventListener('click', () => scrollPage(1));

      if (grid) {
        grid.addEventListener('click', (e) => {
          const card = e.target.closest('.sp-card');
          if (!card) return;
          playFromCard(card, wrapper);
        });
      }
    } else if (list) {
      list.addEventListener('click', (e) => {
        const item = e.target.closest('.sp-list-item');
        if (!item) return;
        playFromCard(item, wrapper);
      });
    }
  }

  function playFromCard(card, wrapper) {
    const uri = card.getAttribute('data-uri');
    const activeSpotify = getSpotify();
    if (uri && activeSpotify && typeof activeSpotify.playContext === 'function') {
      wrapper.querySelectorAll('.sp-card, .sp-list-item').forEach((c) => c.classList.remove('sp-playing'));
      card.classList.add('sp-playing');
      activeSpotify.playContext(uri);
    }
  }

  async function fetchPlaylists(wrapper, spotify, force, viewPrefs) {
    if (state.loading) return;

    // Return cached playlists if already loaded and not forcing a refresh
    if (state.loaded && !force && state.playlists.length > 0) {
      const target = wrapper.querySelector('#spGrid') || wrapper.querySelector('#spList');
      if (target && !target.querySelector('.sp-card, .sp-list-item')) {
        renderItems(wrapper, state.playlists, viewPrefs);
      }
      return;
    }

    state.loading = true;
    const target = wrapper.querySelector('#spGrid') || wrapper.querySelector('#spList');

    // Only show loading spinner if the target doesn't have items yet
    if (target && !target.querySelector('.sp-card, .sp-list-item')) {
      target.innerHTML = `
        <div class="sp-loading-container">
          <div class="sp-spinner"></div>
          <span>Loading playlists...</span>
        </div>
      `;
    }

    try {
      let playlists = [];
      if (typeof spotify.getUserPlaylists === 'function') {
        // `force` here only ever comes from the explicit refresh-icon
        // click (see the two call sites of fetchPlaylists above), so it's
        // safe to pass straight through as the "bypass the shared
        // playlist cache" flag too — a real refresh really should hit
        // Spotify again, not just re-serve whatever this or the
        // dashboard's playlists drawer already fetched.
        playlists = await spotify.getUserPlaylists(40, false, force);
      } else if (typeof spotify.getRecentPlaylists === 'function') {
        playlists = await spotify.getRecentPlaylists(true);
      }

      state.playlists = playlists || [];
      state.loaded = true;
      state.loading = false;

      if (!target) return;

      if (!playlists || playlists.length === 0) {
        target.innerHTML = `
          <div class="sp-empty-container">
            <span>No Spotify playlists found.</span>
          </div>
        `;
        return;
      }

      renderItems(wrapper, state.playlists, viewPrefs);
    } catch (err) {
      console.warn('Spotify Playlists plugin fetch failed:', err);
      state.loading = false;
      if (target && !target.querySelector('.sp-card, .sp-list-item')) {
        target.innerHTML = `
          <div class="sp-empty-container">
            <span>Unable to load playlists.</span>
          </div>
        `;
      }
    }
  }

  function renderItems(wrapper, playlists, viewPrefs) {
    const countEl = wrapper.querySelector('#spPlaylistCount');
    if (countEl) countEl.textContent = playlists.length;

    const isList = (viewPrefs && viewPrefs.mode === 'list') || wrapper.dataset.mode === 'list';
    const target = isList ? wrapper.querySelector('#spList') : wrapper.querySelector('#spGrid');
    if (!target) return;

    if (isList) {
      target.innerHTML = playlists.map((p) => {
        const imgHtml = p.image
          ? `<img class="sp-list-thumb" src="${p.image}" alt="${escapeHtml(p.name)}" loading="lazy" />`
          : `<div class="sp-list-thumb">🎵</div>`;
        const metaText = p.tracksCount ? `${p.tracksCount} tracks` : (p.owner || 'Playlist');
        return `
          <div class="sp-list-item" data-uri="${escapeHtml(p.uri)}" title="${escapeHtml(p.name)}">
            ${imgHtml}
            <div class="sp-list-info">
              <div class="sp-list-title">${escapeHtml(p.name)}</div>
              <div class="sp-list-meta">${escapeHtml(metaText)}</div>
            </div>
          </div>
        `;
      }).join('');
    } else {
      target.innerHTML = playlists.map((p) => {
        const imgHtml = p.image
          ? `<img class="sp-thumb" src="${p.image}" alt="${escapeHtml(p.name)}" loading="lazy" />`
          : `<div class="sp-thumb">🎵</div>`;
        const metaText = p.tracksCount ? `${p.tracksCount} tracks` : (p.owner || 'Playlist');
        return `
          <div class="sp-card" data-uri="${escapeHtml(p.uri)}" title="${escapeHtml(p.name)}">
            ${imgHtml}
            <div class="sp-card-info">
              <div class="sp-card-title">${escapeHtml(p.name)}</div>
              <div class="sp-card-meta">${escapeHtml(metaText)}</div>
            </div>
            <div class="sp-play-badge">▶</div>
          </div>
        `;
      }).join('');
    }

    const spotify = getSpotify();
    if (spotify && typeof spotify.getState === 'function') {
      const spotifyState = spotify.getState();
      if (spotifyState && spotifyState.nowPlaying) {
        updateActiveHighlight(wrapper, spotifyState.nowPlaying);
      }
    }
  }

  function updateActiveHighlight(wrapper, currentTrack) {
    if (!wrapper || !currentTrack) return;
    const activeUri = currentTrack.contextUri || currentTrack.playlistUri;
    if (!activeUri) return;

    wrapper.querySelectorAll('.sp-card, .sp-list-item').forEach((card) => {
      const uri = card.getAttribute('data-uri');
      card.classList.toggle('sp-playing', uri === activeUri);
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Register plugin with runtime bridge
  const runtimeKey = '__RydRPluginRuntime__';
  root[runtimeKey] = root[runtimeKey] || {};
  root[runtimeKey][plugin.id] = plugin;
})(window);
