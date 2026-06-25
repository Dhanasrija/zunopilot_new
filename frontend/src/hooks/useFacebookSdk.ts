import { useEffect, useState } from 'react';

declare global {
  interface Window {
    FB?: any;
    fbAsyncInit?: () => void;
  }
}

const SCRIPT_ID = 'facebook-jssdk';

interface Options {
  appId?: string;
  graphVersion?: string; // e.g. "v21.0"
}

// Loads the Facebook JS SDK once, initialises FB with the provided appId,
// and returns a `ready` flag the caller can use to enable the login button.
export function useFacebookSdk({ appId, graphVersion = 'v21.0' }: Options) {
  const [ready, setReady] = useState(!!window.FB);

  useEffect(() => {
    if (!appId) return;
    if (window.FB) {
      window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version: graphVersion });
      setReady(true);
      return;
    }
    if (document.getElementById(SCRIPT_ID)) return; // script tag already injected; wait for fbAsyncInit

    window.fbAsyncInit = () => {
      window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version: graphVersion });
      setReady(true);
    };

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    script.src = 'https://connect.facebook.net/en_US/sdk.js';
    document.body.appendChild(script);
  }, [appId, graphVersion]);

  return ready;
}
