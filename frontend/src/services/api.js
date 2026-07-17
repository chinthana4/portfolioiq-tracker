import axios from 'axios';

// In production on Render the frontend is a static site calling a separate backend.
// VITE_API_URL is injected at build time. In dev, Vite proxies /api → localhost:3001.
const BASE = import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : '/api';

const api = axios.create({ baseURL: BASE });

api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  r => r.data,
  err => Promise.reject(err.response?.data?.error || err.message)
);

export const auth = {
  register: d => api.post('/auth/register', d),
  login:    d => api.post('/auth/login', d),
  me:       () => api.get('/auth/me'),
};

export const platforms = {
  list:   ()       => api.get('/platforms'),
  create: d        => api.post('/platforms', d),
  update: (id, d)  => api.put(`/platforms/${id}`, d),
  delete: id       => api.delete(`/platforms/${id}`),
};

export const transactions = {
  list:    params => api.get('/transactions', { params }),
  summary: ()     => api.get('/transactions/summary'),
  create:  d      => api.post('/transactions', d),
  update:  (id,d) => api.put(`/transactions/${id}`, d),
  delete:  id     => api.delete(`/transactions/${id}`),
};

export const sales = {
  list:    ()  => api.get('/sales'),
  summary: ()  => api.get('/sales/summary'),
  create:  d   => api.post('/sales', d),
  delete:  id  => api.delete(`/sales/${id}`),
};

export const prices = {
  live:    (ticker, exchange) => api.get('/prices/live', { params: { ticker, exchange } }),
  refresh: ()                 => api.post('/prices/refresh'),
  thaiMF:  ()                 => api.get('/prices/thai-mf'),
  bulkNav: updates            => api.post('/prices/bulk-nav', { updates }),
};

export default api;
