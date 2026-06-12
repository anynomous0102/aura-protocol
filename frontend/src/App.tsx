import AuraAppShell from "./components/App/AuraAppShell";
import { AppContextProvider } from "./context/AppContext";

export default function App() {
  return (
    <AppContextProvider>
      <AuraAppShell />
    </AppContextProvider>
  );
}
