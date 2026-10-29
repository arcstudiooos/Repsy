import { EmptyState } from '@/components/states/EmptyState';

export default function Page() {
  return (
    <EmptyState
      title="No messages yet"
      body="Your conversation with this client will appear here."
    />
  );
}
