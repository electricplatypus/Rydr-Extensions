// Alias loader for plugins/spotify-playlists/spotify-playlist.js -> plugins/spotify-playlists/spotify-playlists.js
(function (root) {
  // If main plugin script is already loaded, nothing to do
  if (root.__RydRPluginRuntime__ && root.__RydRPluginRuntime__['spotify-playlists']) {
    return;
  }
  // Otherwise load spotify-playlists.js
  const script = document.createElement('script');
  script.src = './plugins/spotify-playlists/spotify-playlists.js';
  document.head.appendChild(script);
})(window);
