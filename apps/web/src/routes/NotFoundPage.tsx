import { Link } from 'react-router';
import { EmptyState } from '../components/ui/primitives.js';

export function NotFoundPage() {
  return (
    <EmptyState
      title="This screen does not exist"
      action={
        <Link className="text-cobalt underline" to="/">
          Back to overview
        </Link>
      }
    >
      Check the address or use the navigation on the left.
    </EmptyState>
  );
}
