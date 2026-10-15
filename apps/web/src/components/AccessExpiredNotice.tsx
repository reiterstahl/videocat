import { useEffect, useState } from "react";
import { LogIn, ShieldAlert } from "lucide-react";
import { accessExpiredEvent, accessSignInUrl } from "../lib/api";

// Shown when an access proxy in front of VideoCAT (for example Cloudflare Access) asks to sign in again.
export function AccessExpiredNotice() {
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    const show = () => setExpired(true);
    window.addEventListener(accessExpiredEvent, show);
    return () => window.removeEventListener(accessExpiredEvent, show);
  }, []);

  if (!expired) return null;
  return (
    <div className="vc-access-expired" role="alert">
      <ShieldAlert size={20} aria-hidden="true" />
      <div>
        <strong>Tu sesión de acceso expiró</strong>
        <span>El sitio está protegido por un acceso previo (por ejemplo, Cloudflare Access) y pide iniciar sesión otra vez. Tus datos no se perdieron.</span>
      </div>
      <button className="vc-button is-primary" onClick={() => window.location.assign(accessSignInUrl())} type="button">
        <LogIn size={16} /> Volver a iniciar sesión
      </button>
    </div>
  );
}
