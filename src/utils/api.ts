export const getApiBaseUrl = () => {
  // If running from file:// (Electron packaged), we need an absolute URL to the backend.
  if (typeof window !== 'undefined' && window.location.protocol === 'file:') {
    // ----------------------------------------------------------------------------------
    // PRODUCTION CLOUD URL
    return 'https://quest-compendium-557969397549.us-east1.run.app';
    // ----------------------------------------------------------------------------------
  }
  // If running in development (localhost:3000) or as a web app on the cloud, use relative paths
  return '';
};
