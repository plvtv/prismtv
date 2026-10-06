let loading = null;
export function loadQr() {
  if (window.QRCode) return Promise.resolve();
  if (!loading) loading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
    script.onload = resolve;
    script.onerror = () => { loading = null; script.remove(); reject(new Error('QR code unavailable')); };
    document.head.append(script);
  });
  return loading;
}
