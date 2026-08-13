import { Evidence } from '../components/Evidence.js';
import { Library } from '../components/Library.js';
import { Mark } from '../components/Mark.js';
import { Statement } from '../components/Statement.js';
import { navigate, useStore } from '../store.js';

export function WorkspaceScreen(): JSX.Element {
  const { workspace, selected, loading, error } = useStore();

  if (loading) {
    return (
      <div className="page">
        <div className="page__in">
          <p className="empty">Loading the workspace…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <div className="page__in">
          <div className="card card--bad">
            <p className="eyebrow">Cannot reach the server</p>
            <p className="note" style={{ margin: 0 }}>
              {error}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {workspace?.pinCaveat && (
        <div className="banner banner--warn" style={{ borderRadius: 0, borderWidth: '0 0 1px' }}>
          <Mark state="partial" fill={0.5} size={14} />
          <span>{workspace.pinCaveat}</span>
        </div>
      )}
      <div className="cols">
        <Library />
        {selected ? (
          <Statement claim={selected} />
        ) : (
          <div className="col">
            <p className="empty">
              No claims yet. State one, in prose or in Lean — it doesn’t have to be right.
            </p>
          </div>
        )}
        {selected ? (
          <Evidence claim={selected} />
        ) : (
          <div className="col">
            <p className="lbl">Evidence</p>
            <p className="empty" style={{ padding: 0 }}>
              Nothing selected.
            </p>
          </div>
        )}
      </div>
      <StatusBar />
    </>
  );
}

function StatusBar(): JSX.Element {
  const { workspace, selected } = useStore();
  const counts = workspace?.counts;

  return (
    <div className="foot">
      <Mark state={selected?.view.mark ?? 'open'} fill={selected?.view.fill ?? 0} size={14} />
      <span className="meta" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {selected ? selected.view.summary : 'no claim selected'}
      </span>
      <span className="bar__sep" />
      <span className="meta">
        {counts?.total ?? 0} claims · {counts?.byState.proved ?? 0} proved ·{' '}
        {counts?.byState.refuted ?? 0} refuted · {counts?.totalSorries ?? 0} sorry
      </span>
      <span className="bar__spacer" />
      {selected && (
        <button
          className="btn btn--ghost"
          type="button"
          style={{ padding: '4px 10px', fontSize: 11 }}
          onClick={() => navigate(`/share/${selected.id}`)}
        >
          Share card
        </button>
      )}
    </div>
  );
}
