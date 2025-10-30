import L from 'leaflet';

// 地図を初期化して #map に表示
const map = L.map('map').setView([35.3606, 138.7274], 6); // 御殿場市周辺

// OpenStreetMap タイルを読み込み
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors',
  maxZoom: 18,
}).addTo(map);

// マーカーを追加（仮の位置）
L.marker([35.3606, 138.7274])
  .addTo(map)
  .bindPopup('ここが御殿場市です')
  .openPopup();