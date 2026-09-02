import { useState } from "react";
import { toast } from "react-toastify";
import { LOGO_INECO_DATA_URL } from "../assets/logoIneco";
import { useAuth } from "../auth/AuthContext";
import { friendlyLoginError } from "../lib/friendlyLoginError";

export function LoginPage() {
  const { loginWithProvider } = useAuth();
  const [submitting, setSubmitting] = useState<"google" | "microsoft" | null>(
    null,
  );

  async function handleProvider(provider: "google" | "microsoft") {
    setSubmitting(provider);
    try {
      await loginWithProvider(provider);
    } catch (err) {
      const { code, message } = friendlyLoginError(err);
      if (code === "PENDING") {
        toast.info(message, { autoClose: 8000 });
      } else {
        toast.error(message);
      }
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-card__brand">
          <img src={LOGO_INECO_DATA_URL} alt="Ineco" className="auth-card__logo" />
        </div>

        <div className="auth-oauth">
          <button
            type="button"
            className="auth-oauth__btn auth-oauth__btn--google"
            disabled={submitting !== null}
            onClick={() => void handleProvider("google")}
          >
            <GoogleIcon />
            {submitting === "google" ? "Conectando…" : "Continuar con Google"}
          </button>
          <button
            type="button"
            className="auth-oauth__btn auth-oauth__btn--microsoft"
            disabled={submitting !== null}
            onClick={() => void handleProvider("microsoft")}
          >
            <MicrosoftIcon />
            {submitting === "microsoft"
              ? "Conectando…"
              : "Continuar con Microsoft"}
          </button>
        </div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.2 6.1 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.5-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.2 6.1 29.4 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.3 35.9 26.8 37 24 37c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.6 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-1.1 3.2-3.5 5.7-6.5 7.1l.1.1 6.2 5.2C37.5 38.3 44 33 44 24c0-1.3-.1-2.5-.4-3.5z"
      />
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 23 23" aria-hidden>
      <path fill="#f35325" d="M1 1h10v10H1z" />
      <path fill="#81bc06" d="M12 1h10v10H12z" />
      <path fill="#05a6f0" d="M1 12h10v10H1z" />
      <path fill="#ffba08" d="M12 12h10v10H12z" />
    </svg>
  );
}
