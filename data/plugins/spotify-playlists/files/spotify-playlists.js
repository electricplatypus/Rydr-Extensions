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
    lastViewPrefsString: '',
    // Podcasts tab
    shows: [],
    showsLoaded: false,
    showsLoading: false,
    openShow: null, // { id, name, kind: 'show' | 'audiobook' } while its episodes / chapters are open
    episodes: [],
    epHasMore: false,
    epLoading: false,
    epFailed: false,
    epScrollTop: null // remembered so a redraw doesn't lose the place
  };

  const SORT_OPTIONS = [
    { value: 'default', label: 'Default' },
    { value: 'alpha', label: 'A–Z' },
    { value: 'tracks', label: 'Most Tracks' },
    { value: 'recent', label: 'Recently Played' }
  ];

  // Library filter buttons: everything, or just one kind. Remembered per
  // device (a view preference, like list/grid).
  const FILTERS = [
    { value: 'all', label: 'All', empty: 'Nothing saved in your Spotify library yet.' },
    { value: 'playlist', label: 'Playlists', empty: 'No saved playlists.' },
    { value: 'album', label: 'Albums', empty: 'No saved albums.' },
    { value: 'audiobook', label: 'Audiobooks', empty: 'No saved audiobooks.' },
    // Podcasts is its own view, not part of All: tapping a show opens its
    // episodes instead of playing it.
    { value: 'podcast', label: 'Podcasts', empty: 'No followed podcasts.' }
  ];
  const FILTER_KEY = 'rydr_spotify_library_filter';
  function getFilter() {
    try {
      const v = localStorage.getItem(FILTER_KEY);
      return FILTERS.some((f) => f.value === v) ? v : 'all';
    } catch (e) {
      return 'all';
    }
  }
  function setFilter(v) {
    try { localStorage.setItem(FILTER_KEY, v); } catch (e) {}
  }
  function applyFilter(items) {
    const f = getFilter();
    if (f === 'all') return items;
    return items.filter((p) => (p.type || 'playlist') === f);
  }

  // Which episode the rider was last on in each show: { showId: { n, t } }.
  // Lets the shows list put in-progress shows first without fetching every
  // show's episodes. Updated when a show is opened or an episode is tapped.
  const PROGRESS_KEY = 'rydr_spotify_show_progress';
  function readProgress() {
    try {
      const o = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}');
      return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
    } catch (e) {
      return {};
    }
  }
  function setProgress(showId, episodeName) {
    const map = readProgress();
    if (episodeName) map[showId] = { n: String(episodeName).slice(0, 200), t: Date.now() };
    else delete map[showId];
    const ids = Object.keys(map);
    if (ids.length > 300) {
      ids.sort((a, b) => (map[a].t || 0) - (map[b].t || 0)).slice(0, ids.length - 300).forEach((k) => delete map[k]);
    }
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(map)); } catch (e) {}
  }

  function formatDate(d) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) return d || '';
    const dt = new Date(`${d}T00:00:00`);
    if (isNaN(dt)) return d;
    const opts = { month: 'short', day: 'numeric' };
    if (dt.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    return dt.toLocaleDateString(undefined, opts);
  }
  function formatMinutes(ms) {
    const min = Math.max(1, Math.round(ms / 60000));
    return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
  }

  function getSpotify() {
    return root.RydRSpotify || window.RydRSpotify || (typeof RydRSpotify !== 'undefined' ? RydRSpotify : null);
  }

  const plugin = {
    id: 'spotify-playlists',
    name: 'Spotify Playlists',
    description: 'Browse your Spotify playlists, saved albums, audiobooks and podcasts as a list or a thumbnail grid, with filters, sort and quick-play.',
    version: '1.5.1',
    icon: '🎵',
    category: 'media',
    // Own full-bleed card look, like the first-party Spotify controller —
    // render() already paints its own header/background/everything
    // (.sp-plugin-surface), so the generic plugin-card icon/title bar was
    // just a redundant second header sitting on top of it.
    standalone: true,

    render: function (container, payload) {
      state.container = container;
      const spotify = getSpotify();
      const isConnected = !!(spotify && typeof spotify.getState === 'function' && spotify.getState().connected);

      // Handle disconnected state
      if (!spotify || !isConnected) {
        state.loaded = false;
        state.playlists = [];
        state.shows = [];
        state.showsLoaded = false;
        state.openShow = null;
        state.episodes = [];
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
        } else if (wrapper && getFilter() === 'podcast') {
          renderPodcasts(wrapper, viewPrefs);
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
        // A changed sort/selection must re-run the list, not re-serve the
        // already-sorted copy held in state (fetchPlaylists' cache shortcut).
        if (prefsChanged) state.loaded = false;
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

  // Shared <style> block for both the connected wrapper and the
  // disconnected prompt — extracted so the disconnected state (shown
  // before a rider has connected Spotify at all) gets the plugin's own
  // dark, branded styling too instead of sitting unstyled on whatever
  // background happens to be behind it.
  const PLUGIN_STYLE = `
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
        .sp-filter-bar {
          display: flex;
          gap: calc(6px * var(--scale));
          margin: 0 0 calc(8px * var(--scale));
          overflow-x: auto;
          scrollbar-width: none;
          flex-shrink: 0;
        }
        .sp-filter-bar::-webkit-scrollbar { display: none; }
        .sp-filter-btn {
          flex: 0 0 auto;
          min-height: calc(30px * var(--scale));
          padding: 0 calc(12px * var(--scale));
          border-radius: 999px;
          border: 1px solid rgba(255, 255, 255, 0.14);
          background: transparent;
          color: rgba(255, 255, 255, 0.78);
          font-family: inherit;
          font-size: calc(12px * var(--scale));
          font-weight: 600;
          line-height: 1;
          cursor: pointer;
          transition: background 0.15s, color 0.15s, border-color 0.15s;
        }
        .sp-filter-btn:hover { border-color: rgba(255, 255, 255, 0.35); color: #fff; }
        .sp-filter-btn[aria-pressed="true"] {
          background: #1db954;
          border-color: #1db954;
          color: #0b0b0b;
        }
        .sp-filter-btn:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
        /* Podcasts: a show's episodes replace the grid/list while open. */
        .sp-playlists-wrapper[data-view="episodes"] .sp-playlists-viewport,
        .sp-playlists-wrapper[data-view="episodes"] .sp-list,
        .sp-playlists-wrapper[data-view="episodes"] .sp-sort-select,
        .sp-playlists-wrapper[data-view="episodes"] #spViewToggleBtn,
        .sp-playlists-wrapper[data-view="episodes"] #spNavPrev,
        .sp-playlists-wrapper[data-view="episodes"] #spNavNext,
        .sp-playlists-wrapper[data-filter="podcast"] .sp-sort-select { display: none; }
        .sp-episodes[hidden] { display: none; }
        .sp-episodes {
          position: relative;
          display: flex;
          flex-direction: column;
          flex: 1 1 auto;
          min-height: calc((4 * 44px + 3 * 4px) * var(--scale));
          min-width: 0;
        }
        .sp-ep-head {
          display: flex;
          align-items: center;
          gap: calc(8px * var(--scale));
          margin-bottom: calc(6px * var(--scale));
          min-width: 0;
        }
        .sp-ep-show {
          font-size: calc(13px * var(--scale));
          font-weight: 700;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          min-width: 0;
        }
        .sp-ep-scroll {
          flex: 1 1 0;
          min-height: 0;
          overflow-y: auto;
          overscroll-behavior: contain;
          display: flex;
          flex-direction: column;
          gap: calc(4px * var(--scale));
          padding: 2px;
          scrollbar-width: thin;
        }
        .sp-ep-row {
          display: flex;
          align-items: center;
          gap: calc(10px * var(--scale));
          width: 100%;
          flex: 0 0 auto;
          min-height: calc(52px * var(--scale));
          padding: calc(8px * var(--scale)) calc(10px * var(--scale));
          border-radius: calc(8px * var(--scale));
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.08);
          color: #fff;
          font-family: inherit;
          text-align: left;
          cursor: pointer;
          box-sizing: border-box;
        }
        .sp-ep-row:hover { background: rgba(255, 255, 255, 0.1); }
        .sp-ep-row:focus-visible { outline: 2px solid #fff; outline-offset: 1px; }
        .sp-ep-row.sp-ep-current { border-color: rgba(29, 185, 84, 0.7); }
        .sp-ep-row.sp-playing { border-color: #1db954; background: rgba(29, 185, 84, 0.16); }
        .sp-ep-main { display: flex; flex-direction: column; gap: calc(3px * var(--scale)); min-width: 0; flex: 1; }
        .sp-ep-title {
          font-size: calc(12.5px * var(--scale));
          font-weight: 600;
          line-height: 1.25;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .sp-ep-played .sp-ep-title { color: rgba(255, 255, 255, 0.55); font-weight: 500; }
        .sp-ep-meta { font-size: calc(10.5px * var(--scale)); color: rgba(255, 255, 255, 0.55); }
        .sp-ep-state { margin-left: calc(8px * var(--scale)); color: #1db954; font-weight: 600; }
        .sp-ep-played .sp-ep-state { color: rgba(255, 255, 255, 0.55); font-weight: 500; }
        .sp-ep-bar { height: 3px; border-radius: 2px; background: rgba(255, 255, 255, 0.14); overflow: hidden; }
        .sp-ep-bar > span { display: block; height: 100%; background: #1db954; }
        .sp-ep-play { flex: 0 0 auto; font-size: calc(11px * var(--scale)); color: rgba(255, 255, 255, 0.6); }
        .sp-ep-row.sp-playing .sp-ep-play { color: #1db954; }
        .sp-ep-foot {
          flex: 0 0 auto;
          text-align: center;
          padding: calc(10px * var(--scale)) 0 calc(14px * var(--scale));
          font-size: calc(10.5px * var(--scale));
          color: rgba(255, 255, 255, 0.45);
        }
        .sp-ep-top[hidden] { display: none; }
        .sp-ep-top {
          position: absolute;
          right: calc(8px * var(--scale));
          bottom: calc(8px * var(--scale));
          width: calc(40px * var(--scale));
          height: calc(40px * var(--scale));
          border-radius: 50%;
          border: none;
          background: #1db954;
          color: #0b0b0b;
          font-size: calc(18px * var(--scale));
          font-weight: 700;
          line-height: 1;
          cursor: pointer;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
          z-index: 5;
        }
        .sp-ep-top:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
        .sp-in-progress .sp-card-meta, .sp-in-progress .sp-list-meta { color: #1db954; }
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
`;

  function renderDisconnected(container, spotify) {
    container.innerHTML = `
      ${PLUGIN_STYLE}
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
      ${PLUGIN_STYLE}
      <div class="sp-plugin-surface sp-playlists-wrapper" data-mode="${isList ? 'list' : 'thumbnail'}" data-filter="${getFilter()}">
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
            <span class="sp-minimize-slot" data-minimize-slot></span>
          </div>
        </div>
        <div class="sp-filter-bar" role="group" aria-label="Show">
          ${FILTERS.map((f) => `<button type="button" class="sp-filter-btn" data-filter="${f.value}" aria-pressed="${f.value === getFilter()}">${f.label}</button>`).join('')}
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
        <div class="sp-episodes" id="spEpisodes" hidden>
          <div class="sp-ep-head">
            <button type="button" class="sp-nav-btn" id="spEpBack" title="Back" aria-label="Back to the list">‹</button>
            <div class="sp-ep-show" id="spEpShow"></div>
          </div>
          <div class="sp-ep-scroll" id="spEpScroll"></div>
          <button type="button" class="sp-ep-top" id="spEpTop" title="Back to top" aria-label="Back to the top of the list" hidden>↑</button>
        </div>
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

    wrapper.querySelectorAll('.sp-filter-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const value = btn.getAttribute('data-filter');
        if (value === getFilter()) return;
        setFilter(value);
        wrapper.querySelectorAll('.sp-filter-btn').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
        const target = wrapper.querySelector('#spGrid') || wrapper.querySelector('#spList');
        if (target) target.scrollLeft = 0;
        state.openShow = null;
        if (value === 'podcast') renderPodcasts(wrapper, viewPrefs);
        else if (state.loaded) renderItems(wrapper, state.playlists, viewPrefs);
        else showEpisodePanel(wrapper, false);
      });
    });

    const epBack = wrapper.querySelector('#spEpBack');
    const epScroll = wrapper.querySelector('#spEpScroll');
    const epTop = wrapper.querySelector('#spEpTop');
    if (epBack) {
      epBack.addEventListener('click', (e) => {
        e.stopPropagation();
        state.openShow = null;
        state.epScrollTop = null;
        if (getFilter() === 'podcast') renderPodcasts(wrapper, viewPrefs);
        else renderItems(wrapper, state.playlists, viewPrefs);
      });
    }
    if (epScroll) {
      epScroll.addEventListener('click', (e) => {
        const row = e.target.closest('.sp-ep-row');
        if (row) playEpisode(row, wrapper);
      });
      epScroll.addEventListener('scroll', () => {
        state.epScrollTop = epScroll.scrollTop;
        if (epTop) epTop.hidden = epScroll.scrollTop < 60;
        // Older episodes load as the rider nears the bottom.
        if (state.epHasMore && !state.epLoading && epScroll.scrollTop + epScroll.clientHeight > epScroll.scrollHeight - 160) {
          loadEpisodes(wrapper, false);
        }
      }, { passive: true });
    }
    if (epTop) {
      epTop.addEventListener('click', (e) => {
        e.stopPropagation();
        if (epScroll) epScroll.scrollTo({ top: 0, behavior: 'smooth' });
      });
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
        const done = () => refreshBtn.classList.remove('sp-spinning');
        if (state.openShow) {
          loadEpisodes(wrapper, true).then(done, done);
          return;
        }
        if (getFilter() === 'podcast') {
          loadShows(wrapper, viewPrefs, true).then(done, done);
          return;
        }
        state.loaded = false;
        fetchPlaylists(wrapper, spotify, true, viewPrefs).then(done);
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
          if (card.dataset.showId || card.dataset.bookId) return openShow(card, wrapper, viewPrefs);
          playFromCard(card, wrapper);
        });
      }
    } else if (list) {
      list.addEventListener('click', (e) => {
        const item = e.target.closest('.sp-list-item');
        if (!item) return;
        if (item.dataset.showId || item.dataset.bookId) return openShow(item, wrapper, viewPrefs);
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
        playlists = await spotify.getUserPlaylists(200, false, force);
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

      // Fill in each playlist's artist line, then redraw once if it changed.
      if (typeof spotify.loadPlaylistArtists === 'function') {
        const shown = state.playlists;
        spotify.loadPlaylistArtists(shown).then((changed) => {
          if (changed && state.playlists === shown && wrapper.isConnected) renderItems(wrapper, shown, viewPrefs);
        });
      }
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

  // Line under the title: a playlist's main artists (album → artist,
  // audiobook → author) — never the owner's user name.
  function subtitleFor(p) {
    const spotify = getSpotify();
    if (spotify && typeof spotify.itemSubtitle === 'function') return spotify.itemSubtitle(p);
    const artists = Array.isArray(p.artists) ? p.artists.slice(0, 3).join(', ') : '';
    return artists || (p.tracksCount ? `${p.tracksCount} tracks` : 'Playlist');
  }

  // ---------- Podcasts ----------
  function showEpisodePanel(wrapper, on) {
    const panel = wrapper.querySelector('#spEpisodes');
    if (panel) panel.hidden = !on;
    wrapper.dataset.view = on ? 'episodes' : '';
    wrapper.dataset.filter = getFilter();
  }

  function renderPodcasts(wrapper, viewPrefs) {
    if (state.openShow) {
      showEpisodePanel(wrapper, true);
      renderEpisodes(wrapper, false);
      return;
    }
    showEpisodePanel(wrapper, false);
    if (!state.showsLoaded) {
      loadShows(wrapper, viewPrefs, false);
      return;
    }
    renderShows(wrapper, viewPrefs);
  }

  async function loadShows(wrapper, viewPrefs, force) {
    const spotify = getSpotify();
    if (state.showsLoading || !spotify || typeof spotify.getShows !== 'function') return;
    state.showsLoading = true;
    const target = wrapper.querySelector('#spGrid') || wrapper.querySelector('#spList');
    if (target && !state.showsLoaded) {
      target.innerHTML = '<div class="sp-loading-container"><div class="sp-spinner"></div><span>Loading podcasts...</span></div>';
    }
    try {
      state.shows = (await spotify.getShows(force)) || [];
    } catch (e) {
      state.shows = [];
    }
    state.showsLoaded = true;
    state.showsLoading = false;
    if (wrapper.isConnected && getFilter() === 'podcast' && !state.openShow) renderShows(wrapper, viewPrefs);
  }

  // Shows the rider is partway through come first (most recent first),
  // then the rest in Spotify's order (most recently followed first).
  function orderedShows() {
    const progress = readProgress();
    return state.shows
      .map((sh, i) => ({ sh, i, t: progress[sh.id] ? progress[sh.id].t || 1 : 0, n: progress[sh.id] ? progress[sh.id].n : '' }))
      .sort((a, b) => b.t - a.t || a.i - b.i);
  }

  function renderShows(wrapper, viewPrefs) {
    const isList = (viewPrefs && viewPrefs.mode === 'list') || wrapper.dataset.mode === 'list';
    const target = isList ? wrapper.querySelector('#spList') : wrapper.querySelector('#spGrid');
    const countEl = wrapper.querySelector('#spPlaylistCount');
    if (countEl) countEl.textContent = state.shows.length;
    if (!target) return;
    if (!state.shows.length) {
      target.innerHTML = '<div class="sp-empty-container"><span>No followed podcasts.</span></div>';
      return;
    }
    target.innerHTML = orderedShows().map(({ sh, n }) => {
      const meta = n ? `Continue: ${n}` : (sh.episodesCount ? `${sh.episodesCount} episodes` : 'Podcast');
      return itemHtml(sh, isList, meta, ` data-show-id="${escapeHtml(sh.id)}"`, n ? ' sp-in-progress' : '');
    }).join('');
  }

  function openShow(card, wrapper, viewPrefs) {
    const bookId = card.dataset.bookId;
    const id = bookId || card.dataset.showId;
    const show = bookId
      ? state.playlists.find((p) => p.type === 'audiobook' && p.id === id)
      : state.shows.find((sh) => sh.id === id);
    if (!show) return;
    state.openShow = { id: show.id, name: show.name, kind: bookId ? 'audiobook' : 'show' };
    state.episodes = [];
    state.epHasMore = false;
    state.epFailed = false;
    state.epScrollTop = null;
    showEpisodePanel(wrapper, true);
    renderEpisodes(wrapper, false);
    loadEpisodes(wrapper, true);
  }

  // reset=true loads the newest page; otherwise the next (older) page.
  async function loadEpisodes(wrapper, reset) {
    const spotify = getSpotify();
    const show = state.openShow;
    const isBook = !!show && show.kind === 'audiobook';
    const fetchPage = spotify && (isBook ? spotify.getAudiobookChapters : spotify.getShowEpisodes);
    if (!show || state.epLoading || typeof fetchPage !== 'function') return;
    state.epLoading = true;
    if (!reset) renderEpisodeFooter(wrapper);
    let page = null;
    try {
      page = await fetchPage(show.id, reset ? 0 : state.episodes.length);
    } catch (e) {}
    state.epLoading = false;
    if (state.openShow !== show) return; // rider went back / opened another show meanwhile
    if (!page) {
      state.epFailed = true;
      state.epHasMore = false;
    } else {
      state.epFailed = false;
      const seen = new Set(reset ? [] : state.episodes.map((e) => e.id));
      const fresh = page.items.filter((e) => !seen.has(e.id));
      state.episodes = reset ? fresh : state.episodes.concat(fresh);
      state.epHasMore = page.hasMore && fresh.length > 0;
      // A long book: the rider's place can be past the first 50 chapters.
      // Keep loading while everything so far is finished (max 300 chapters).
      state.epLoading = true;
      for (let n = 1; reset && isBook && page.hasProgress && state.epHasMore && n < 6 && state.episodes.every((e) => e.played); n++) {
        let more = null;
        try { more = await fetchPage(show.id, state.episodes.length); } catch (e) {}
        if (state.openShow !== show) { state.epLoading = false; return; }
        if (!more || !more.items.length) break;
        const have = new Set(state.episodes.map((e) => e.id));
        const add = more.items.filter((e) => !have.has(e.id));
        state.episodes = state.episodes.concat(add);
        state.epHasMore = more.hasMore && add.length > 0;
      }
      state.epLoading = false;
      if (reset) {
        if (page.hasProgress) {
          const idx = currentIndex(state.episodes, isBook);
          setProgress(show.id, idx >= 0 ? state.episodes[idx].name : '');
        }
        state.epScrollTop = null;
      }
    }
    if (wrapper.isConnected) renderEpisodes(wrapper, reset);
  }

  // Where the rider is: the episode/chapter they're partway through. In a
  // book (read in order) with nothing half-played, it's the chapter after
  // the last finished one. -1 = nothing started.
  function currentIndex(list, isBook) {
    const partial = list.findIndex((e) => e.resumeMs > 0 && !e.played);
    if (partial >= 0 || !isBook) return partial;
    let last = -1;
    list.forEach((e, i) => { if (e.played) last = i; });
    return last >= 0 && last + 1 < list.length ? last + 1 : -1;
  }

  function episodeRowHtml(ep, isCurrent) {
    const inProgress = ep.resumeMs > 0 && !ep.played;
    const stateText = ep.played ? 'Played' : inProgress ? `${formatMinutes(Math.max(0, ep.durationMs - ep.resumeMs))} left` : '';
    const pct = inProgress && ep.durationMs ? Math.min(100, Math.max(2, Math.round((ep.resumeMs / ep.durationMs) * 100))) : 0;
    const meta = [ep.number ? `Chapter ${ep.number}` : formatDate(ep.date), ep.durationMs ? formatMinutes(ep.durationMs) : ''].filter(Boolean).join(' · ');
    return `
      <button type="button" class="sp-ep-row${ep.played ? ' sp-ep-played' : ''}${isCurrent ? ' sp-ep-current' : ''}" data-uri="${escapeHtml(ep.uri)}" data-resume="${inProgress ? Math.floor(ep.resumeMs) : 0}">
        <span class="sp-ep-main">
          <span class="sp-ep-title">${escapeHtml(ep.name)}</span>
          <span class="sp-ep-meta">${escapeHtml(meta)}${stateText ? `<span class="sp-ep-state">${escapeHtml(stateText)}</span>` : ''}</span>
          ${pct ? `<span class="sp-ep-bar"><span style="width:${pct}%"></span></span>` : ''}
        </span>
        <span class="sp-ep-play" aria-hidden="true">▶</span>
      </button>`;
  }

  function renderEpisodeFooter(wrapper) {
    const scroll = wrapper.querySelector('#spEpScroll');
    if (!scroll) return;
    let foot = scroll.querySelector('.sp-ep-foot');
    if (!foot) {
      foot = document.createElement('div');
      foot.className = 'sp-ep-foot';
      scroll.appendChild(foot);
    }
    const book = !!state.openShow && state.openShow.kind === 'audiobook';
    foot.textContent = state.epLoading ? 'Loading…'
      : state.epFailed ? `Couldn’t load ${book ? 'chapters' : 'episodes'}. Tap refresh to try again.`
      : state.epHasMore ? (book ? 'Scroll for more chapters' : 'Scroll for older episodes')
      : state.episodes.length ? (book ? 'That’s every chapter.' : 'That’s every episode.')
      : (book ? 'No chapters found.' : 'No episodes yet.');
  }

  // jump=true (first page of a show): open at the episode the rider is
  // partway through, so newer ones are above and older ones below.
  function renderEpisodes(wrapper, jump) {
    const scroll = wrapper.querySelector('#spEpScroll');
    const nameEl = wrapper.querySelector('#spEpShow');
    const top = wrapper.querySelector('#spEpTop');
    const countEl = wrapper.querySelector('#spPlaylistCount');
    if (!scroll || !state.openShow) return;
    if (nameEl) nameEl.textContent = state.openShow.name;
    if (countEl) countEl.textContent = state.episodes.length;

    if (!state.episodes.length && state.epLoading) {
      scroll.innerHTML = `<div class="sp-loading-container"><div class="sp-spinner"></div><span>Loading ${state.openShow.kind === 'audiobook' ? 'chapters' : 'episodes'}...</span></div>`;
      if (top) top.hidden = true;
      return;
    }
    const currentIdx = currentIndex(state.episodes, state.openShow.kind === 'audiobook');
    scroll.innerHTML = state.episodes.map((ep, i) => episodeRowHtml(ep, i === currentIdx)).join('');
    renderEpisodeFooter(wrapper);

    if (jump && currentIdx > 0) {
      const row = scroll.querySelectorAll('.sp-ep-row')[currentIdx];
      if (row) scroll.scrollTop = Math.max(0, row.offsetTop - scroll.offsetTop - (scroll.clientHeight - row.offsetHeight) / 2);
    } else if (!jump && state.epScrollTop != null) {
      scroll.scrollTop = state.epScrollTop;
    }
    state.epScrollTop = scroll.scrollTop;
    if (top) top.hidden = scroll.scrollTop < 60;

    const spotify = getSpotify();
    const np = spotify && typeof spotify.getState === 'function' ? spotify.getState().nowPlaying : null;
    updateActiveHighlight(wrapper, np);
  }

  function playEpisode(row, wrapper) {
    const uri = row.getAttribute('data-uri');
    const spotify = getSpotify();
    if (!uri || !spotify || typeof spotify.playContext !== 'function') return;
    wrapper.querySelectorAll('.sp-ep-row').forEach((r) => r.classList.remove('sp-playing'));
    row.classList.add('sp-playing');
    const ep = state.episodes.find((e) => e.uri === uri);
    if (ep && state.openShow) setProgress(state.openShow.id, ep.name);
    spotify.playContext(uri, Number(row.getAttribute('data-resume')) || 0);
  }

  // One card (grid) or row (list). `attrs` / `cls` let the Podcasts view
  // mark a show so tapping it opens its episodes.
  function itemHtml(p, isList, metaText, attrs, cls) {
    const a = attrs || '';
    const c = cls || '';
    if (isList) {
      const imgHtml = p.image
        ? `<img class="sp-list-thumb" src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}" loading="lazy" />`
        : `<div class="sp-list-thumb">🎵</div>`;
      return `
          <div class="sp-list-item${c}" data-uri="${escapeHtml(p.uri)}"${a} title="${escapeHtml(p.name)}">
            ${imgHtml}
            <div class="sp-list-info">
              <div class="sp-list-title">${escapeHtml(p.name)}</div>
              <div class="sp-list-meta">${escapeHtml(metaText)}</div>
            </div>
          </div>
        `;
    }
    const imgHtml = p.image
      ? `<img class="sp-thumb" src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}" loading="lazy" />`
      : `<div class="sp-thumb">🎵</div>`;
    return `
          <div class="sp-card${c}" data-uri="${escapeHtml(p.uri)}"${a} title="${escapeHtml(p.name)}">
            ${imgHtml}
            <div class="sp-card-info">
              <div class="sp-card-title">${escapeHtml(p.name)}</div>
              <div class="sp-card-meta">${escapeHtml(metaText)}</div>
            </div>
            <div class="sp-play-badge">▶</div>
          </div>
        `;
  }

  function renderItems(wrapper, allItems, viewPrefs) {
    if (getFilter() === 'podcast') return renderPodcasts(wrapper, viewPrefs);
    if (state.openShow) {
      // An audiobook's chapters are open: keep them up across redraws.
      showEpisodePanel(wrapper, true);
      renderEpisodes(wrapper, false);
      return;
    }
    showEpisodePanel(wrapper, false);
    const playlists = applyFilter(allItems || []);
    const countEl = wrapper.querySelector('#spPlaylistCount');
    if (countEl) countEl.textContent = playlists.length;

    const isList = (viewPrefs && viewPrefs.mode === 'list') || wrapper.dataset.mode === 'list';
    const target = isList ? wrapper.querySelector('#spList') : wrapper.querySelector('#spGrid');
    if (!target) return;

    if (!playlists.length) {
      const f = FILTERS.find((x) => x.value === getFilter()) || FILTERS[0];
      target.innerHTML = `<div class="sp-empty-container"><span>${escapeHtml(f.empty)}</span></div>`;
      return;
    }

    // Audiobooks open their chapter list (like a podcast show) instead of playing.
    const progress = readProgress();
    target.innerHTML = playlists.map((p) => {
      if (p.type !== 'audiobook') return itemHtml(p, isList, subtitleFor(p));
      const at = progress[p.id] && progress[p.id].n;
      return itemHtml(p, isList, at ? `Continue: ${at}` : subtitleFor(p), ` data-book-id="${escapeHtml(p.id)}"`, at ? ' sp-in-progress' : '');
    }).join('');

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
    if (currentTrack.uri) {
      wrapper.querySelectorAll('.sp-ep-row').forEach((row) => {
        row.classList.toggle('sp-playing', row.getAttribute('data-uri') === currentTrack.uri);
      });
    }
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
