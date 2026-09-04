import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ToastContainer } from "react-toastify";
import { AuthProvider } from "./auth/AuthContext";
import { PendingUsersProvider } from "./auth/PendingUsersContext";
import App from "./App";
import { AppTooltipHost } from "./components/AppTooltip";
import FirmarPage from "./pages/FirmarPage";
import "./index.css";
import "react-toastify/dist/ReactToastify.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        {/* Link público de firma: sin AuthProvider / login */}
        <Route path="/firmar/:medicoId" element={<FirmarPage />} />
        <Route
          path="/*"
          element={
            <AuthProvider>
              <PendingUsersProvider>
                <App />
              </PendingUsersProvider>
            </AuthProvider>
          }
        />
      </Routes>
      <AppTooltipHost />
      <ToastContainer
        position="top-right"
        autoClose={3000}
        hideProgressBar={false}
        newestOnTop
        closeOnClick
        pauseOnHover
        draggable
        theme="colored"
      />
    </BrowserRouter>
  </StrictMode>,
);
