export const getApiBaseUrl = () => {
  // If running from file:// (Electron packaged), use the cloud URL
  if (typeof window !== 'undefined' && window.location.protocol === 'file:') {
    return 'https://ais-pre-7asbcj4i2k3t5ydostzqlu-520069861129.us-east1.run.app';
  }
  // If running in development (localhost:3000) or as a web app on the cloud, use relative paths
  return '';
};
