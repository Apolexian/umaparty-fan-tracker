import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import "./styles.css";
import { Layout } from "./components/Layout.tsx";
import { Home } from "./pages/Home.tsx";
import { Club } from "./pages/Club.tsx";
import { Member } from "./pages/Member.tsx";
import { Standings } from "./pages/Standings.tsx";
import { Officers } from "./pages/Officers.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/club/:id" element={<Club />} />
          <Route path="/m/:id" element={<Member />} />
          <Route path="/standings" element={<Standings />} />
          <Route path="/officers" element={<Officers />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  </StrictMode>,
);
