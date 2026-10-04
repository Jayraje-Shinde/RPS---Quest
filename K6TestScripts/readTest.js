import http from 'k6/http';
export const options = {
  vus: 15000,
  duration: '15s',
};

export default function () {
  const id = Math.floor(Math.random() * 108000) + 1;
  http.get(`http://65.1.94.132:3000/customers/${id}`);
}
