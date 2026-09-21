// Bez importu Reactu — build běží s --jsx=automatic, runtime si JSX
// doplní sám.
import { createRoot } from "react-dom/client";
import App from "./app.jsx";

createRoot(document.getElementById("root")).render(<App />);
