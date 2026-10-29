import { redirect } from 'next/navigation';

// Neutral entry point: signed-in coaches land on the dashboard; the proxy sends everyone else to /login.
export default function Home(): never {
  redirect('/app');
}
