/**
 * Network utilities for handling offline scenarios and connectivity checks
 */

export interface NetworkStatus {
  online: boolean;
  lastChecked: Date;
}

/**
 * Check if the application is online by attempting to fetch a small resource
 * This is more reliable than navigator.onLine which can be unreliable
 */
export async function checkOnlineStatus(): Promise<boolean> {
  try {
    // Try to fetch a small, reliable resource
    const response = await fetch('https://httpbin.org/status/200', {
      method: 'HEAD',
      cache: 'no-cache',
      signal: AbortSignal.timeout(3000), // 3 second timeout
    });
    return response.ok;
  } catch (error) {
    // If fetch fails, we're likely offline
    console.warn('Network check failed, assuming offline mode:', error);
    return false;
  }
}

/**
 * Get current network status with caching to avoid excessive checks
 */
let networkStatusCache: NetworkStatus | null = null;
const CACHE_DURATION = 30000; // 30 seconds

export async function getNetworkStatus(): Promise<NetworkStatus> {
  const now = new Date();

  // Return cached status if it's still fresh
  if (networkStatusCache && (now.getTime() - networkStatusCache.lastChecked.getTime()) < CACHE_DURATION) {
    return networkStatusCache;
  }

  // Check online status
  const online = await checkOnlineStatus();

  networkStatusCache = {
    online,
    lastChecked: now,
  };

  return networkStatusCache;
}

/**
 * Wrapper for fetch that handles offline scenarios gracefully
 */
export async function safeFetch(url: string, options?: RequestInit): Promise<Response | null> {
  const status = await getNetworkStatus();

  if (!status.online) {
    console.warn(`Skipping fetch to ${url} - offline mode detected`);
    return null;
  }

  try {
    return await fetch(url, options);
  } catch (error) {
    console.warn(`Fetch failed for ${url}:`, error);
    return null;
  }
}

/**
 * Hook-like function to monitor network status (for client components)
 * This should be called in useEffect in React components
 */
export function setupNetworkMonitoring(callback: (online: boolean) => void): () => void {
  const handleOnline = () => callback(true);
  const handleOffline = () => callback(false);

  // Listen for browser online/offline events
  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  // Initial check
  getNetworkStatus().then(status => callback(status.online));

  // Return cleanup function
  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  };
}

