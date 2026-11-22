import { FleetProvider, useFleet } from './store/FleetContext';
import { ControlTower } from './views/ControlTower';
import { LiveMapView } from './views/LiveMapView';
import { Business } from './views/Business';
import { Driver } from './views/Driver';
import { LandingView } from './views/LandingView';
import { PaymentsView } from './views/PaymentsView';
import { Register } from './views/Register';
import { Login } from './views/Login';
import { RoleSelect } from './views/RoleSelect';

function Router() {
  const { mode } = useFleet();
  let screen;
  if (mode === 'LANDING') screen = <LandingView />;
  else if (mode === 'REGISTER') screen = <Register />;
  else if (mode === 'LOGIN') screen = <Login />;
  else if (mode === 'CONTROL_TOWER') screen = <ControlTower />;
  else if (mode === 'LIVE_MAP') screen = <LiveMapView />;
  else if (mode === 'PAYMENTS') screen = <PaymentsView />;
  else if (mode === 'BUSINESS') screen = <Business />;
  else if (mode === 'DRIVER') screen = <Driver />;
  else screen = <RoleSelect />;

  return screen;
}

export default function App() {
  return (
    <FleetProvider>
      <Router />
    </FleetProvider>
  );
}
