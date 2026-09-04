export const getApiBaseUrl = () => {
  // If running from file:// (Electron packaged), we need an absolute URL to the backend.
  if (typeof window !== 'undefined' && window.location.protocol === 'file:') {
    // ----------------------------------------------------------------------------------
    // MODE 1: LOCAL TESTING (Default for now)
    // Use this if you are running 'npm run dev' or 'npm start' on your PC in the background.
    return 'http://localhost:3000';
    
    // MODE 2: PRODUCTION CLOUD
    // Once you click "Deploy to Cloud Run" in AI Studio, uncomment the line below 
    // and replace it with your real live URL (e.g., https://quest-compendium-....run.app)
    // return 'https://your-cloud-run-url-here.run.app';
    // ----------------------------------------------------------------------------------
  }
  // If running in development (localhost:3000) or as a web app on the cloud, use relative paths
  return '';
};
