// Per-browser persistence: My List + Continue Watching. Nothing leaves the device.
const LIST_KEY = 'prismtv.mylist';
const HIST_KEY = 'prismtv.history';
const HIST_MAX = 24;

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}

let list = read(LIST_KEY, []);
let history = read(HIST_KEY, []);

export const myList = {
  ids: () => list.slice(),
  has: (id) => list.includes(id),
  toggle(id) {
    list = list.includes(id) ? list.filter((x) => x !== id) : [id, ...list];
    write(LIST_KEY, list);
    return list.includes(id);
  }
};

export const watchHistory = {
  entries: () => history.slice(),
  ids: () => history.map((h) => h.id),
  push(id) {
    history = [{ id, ts: Date.now() }, ...history.filter((h) => h.id !== id)].slice(0, HIST_MAX);
    write(HIST_KEY, history);
  },
  clear() { history = []; write(HIST_KEY, history); }
};
