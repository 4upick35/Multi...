const storage = {};

const AsyncStorage = {
  getItem: jest.fn(async (key) => storage[key] || null),
  setItem: jest.fn(async (key, value) => { storage[key] = value; }),
  removeItem: jest.fn(async (key) => { delete storage[key]; }),
  clear: jest.fn(async () => { Object.keys(storage).forEach(k => delete storage[k]); }),
  getAllKeys: jest.fn(async () => Object.keys(storage)),
  multiGet: jest.fn(async (keys) => keys.map(k => [k, storage[k] || null])),
  multiSet: jest.fn(async (pairs) => pairs.forEach(([k, v]) => { storage[k] = v; })),
  multiRemove: jest.fn(async (keys) => keys.forEach(k => delete storage[k])),
};

export default AsyncStorage;
