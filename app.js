import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

const $ = (id) => document.getElementById(id);
const STATE_TEXT = { yes: '비플페이 가능', no: '비플페이 불가능' };

let zonePolygon, db, channel;
let markers = new Map(); // store id → { marker, store }
let selectedId = null;

const config = await fetch('/api/config').then((r) => r.json());
if (config.supabaseUrl && config.supabaseAnonKey) db = createClient(config.supabaseUrl, config.supabaseAnonKey);

const map = L.map('map', { zoomControl: false }).setView([35.8694, 128.5958], 15);
L.control.zoom({ position: 'bottomleft' }).addTo(map);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);
map.on('click', closeDetail);

function toast(msg, ms) {
  const el = $('status');
  el.textContent = msg;
  el.hidden = !msg;
  clearTimeout(toast.t);
  if (ms) toast.t = setTimeout(() => (el.hidden = true), ms);
}

// ---------- 검색 · 수집 ----------
$('search').addEventListener('submit', (e) => {
  e.preventDefault();
  collect({ q: $('q').value.trim() });
});

async function collect(params) {
  const btn = $('search').querySelector('button');
  btn.disabled = true;
  $('candidates').hidden = true;
  closeDetail();
  toast('구획을 찾고 식당을 수집하는 중…');
  try {
    const res = await fetch('/api/collect?' + new URLSearchParams(params));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '수집에 실패했습니다.');
    if (data.candidates) return showCandidates(data.candidates);
    render(data.zone, data.stores);
    toast(data.saved ? '' : '저장소(Supabase)가 설정되지 않아 제보는 저장되지 않습니다.', 4000);
  } catch (err) {
    toast(err.message, 5000);
  } finally {
    btn.disabled = false;
  }
}

function showCandidates(list) {
  toast('');
  const ul = $('candidates');
  ul.replaceChildren(
    ...list.map((z) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.append(z.name);
      const small = document.createElement('small');
      small.textContent = [z.sido, z.sigungu].filter(Boolean).join(' ');
      b.append(small);
      b.onclick = () => collect({ zone: z.id });
      li.append(b);
      return li;
    })
  );
  ul.hidden = false;
}

// ---------- 지도 그리기 ----------
function render(zone, stores) {
  zonePolygon?.remove();
  for (const { marker } of markers.values()) marker.remove();
  markers = new Map();

  const rings = zone.polygon.map((ring) => ring.map(([lng, lat]) => [lat, lng]));
  zonePolygon = L.polygon(rings, {
    color: '#03c75a', weight: 3, opacity: 0.9,
    fillColor: '#03c75a', fillOpacity: 0.08,
    interactive: false,
  }).addTo(map);
  map.fitBounds(zonePolygon.getBounds(), { paddingTopLeft: [20, 80], paddingBottomRight: [20, 20] });

  for (const s of stores) {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) continue;
    const marker = L.marker([s.lat, s.lng], { icon: pinIcon(s.pay_status), title: s.name })
      .on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        openDetail(s.id);
      })
      .addTo(map);
    markers.set(s.id, { marker, store: s });
  }
  updateSummary(zone);
  subscribe(zone.id);
}

function pinIcon(status, selected) {
  const cls = ['pin', status, selected && 'selected'].filter(Boolean).join(' ');
  return L.divIcon({ className: '', html: `<i class="${cls}"></i>`, iconSize: [18, 18], iconAnchor: [9, 9] });
}

function setStatus(id, status) {
  const entry = markers.get(id);
  if (!entry) return;
  entry.store.pay_status = status;
  entry.marker.setIcon(pinIcon(status, id === selectedId));
  if (id === selectedId) fillDetail(entry.store);
  updateSummary();
}

function updateSummary(zone) {
  if (zone) updateSummary.zone = zone;
  const all = [...markers.values()].map((m) => m.store);
  const yes = all.filter((s) => s.pay_status === 'yes').length;
  const el = $('summary');
  el.textContent = `${updateSummary.zone.name} · 식당 ${all.length}곳 · 비플페이 가능 ${yes}곳`;
  el.hidden = false;
}

// ---------- 식당 상세 · 제보 ----------
function openDetail(id) {
  const prev = selectedId;
  selectedId = id;
  if (prev && markers.has(prev)) setStatus(prev, markers.get(prev).store.pay_status);
  setStatus(id, markers.get(id).store.pay_status);
  $('candidates').hidden = true;
  $('detail').hidden = false;
}

function closeDetail() {
  const prev = selectedId;
  selectedId = null;
  if (prev && markers.has(prev)) setStatus(prev, markers.get(prev).store.pay_status);
  $('detail').hidden = true;
}

function fillDetail(s) {
  $('d-name').textContent = s.branch ? `${s.name} ${s.branch}` : s.name;
  $('d-cat').textContent = [s.category, s.category_detail].filter(Boolean).join(' · ');
  $('d-addr').textContent = s.road_address || s.jibun_address || '';
  $('d-state').textContent = s.pay_status ? `현재: ${STATE_TEXT[s.pay_status]}` : '현재: 미확인';
  for (const b of $('detail').querySelectorAll('.actions button')) b.classList.toggle('on', b.dataset.status === s.pay_status);
}

$('detail').querySelector('.close').addEventListener('click', closeDetail);
for (const b of $('detail').querySelectorAll('.actions button')) {
  b.addEventListener('click', async () => {
    const id = selectedId;
    const status = b.dataset.status;
    const before = markers.get(id).store.pay_status;
    setStatus(id, status);
    if (!db) return toast('저장소가 설정되지 않아 이 화면에만 표시됩니다.', 3000);
    const { error } = await db.from('reports').insert({ store_id: id, status });
    if (error) {
      setStatus(id, before);
      toast('저장에 실패했습니다: ' + error.message, 4000);
    }
  });
}

// 다른 사용자의 제보를 실시간 반영
function subscribe(zoneId) {
  if (!db) return;
  if (channel) db.removeChannel(channel);
  channel = db
    .channel('stores-' + zoneId)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'stores', filter: `zone_id=eq.${zoneId}` },
      ({ new: row }) => {
        if (markers.get(row.id)?.store.pay_status !== row.pay_status) setStatus(row.id, row.pay_status);
      })
    .subscribe();
}
