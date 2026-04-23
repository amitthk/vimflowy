import * as React from 'react';

type Props = {
  documents: string[];
  onSelect: (name: string) => void;
  onCreate: (name: string) => void;
};

type State = {
  newDocName: string;
  creating: boolean;
};

export default class DocumentListComponent extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      newDocName: '',
      creating: false,
    };
  }

  private handleCreate = () => {
    const name = this.state.newDocName.trim();
    if (!name) {
      return;
    }
    this.setState({ creating: true });
    this.props.onCreate(name);
  };

  private handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      this.handleCreate();
    }
  };

  public render() {
    const { documents } = this.props;
    const { newDocName, creating } = this.state;

    return (
      <div style={{
        padding: 40,
        maxWidth: 600,
        margin: '0 auto',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}>
        <h1>My Documents</h1>

        <div style={{ marginBottom: 30 }}>
          <h3>Open a document</h3>
          {documents.length === 0 ? (
            <p style={{ opacity: 0.6 }}>No documents yet. Create one below!</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {documents.map((name) => (
                <li key={name} style={{ marginBottom: 8 }}>
                  <a
                    href={`/?doc=${encodeURIComponent(name)}`}
                    style={{
                      padding: '8px 12px',
                      display: 'inline-block',
                      backgroundColor: '#f0f0f0',
                      borderRadius: 4,
                      textDecoration: 'none',
                      color: '#333',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => {
                      (e.target as HTMLElement).style.backgroundColor = '#e0e0e0';
                    }}
                    onMouseLeave={(e) => {
                      (e.target as HTMLElement).style.backgroundColor = '#f0f0f0';
                    }}
                  >
                    {name || '(default)'}
                  </a>
                </li>
              ))}
            </ul>
          )}
          <a
            href="/"
            style={{
              marginTop: 16,
              padding: '8px 12px',
              display: 'inline-block',
              backgroundColor: '#f0f0f0',
              borderRadius: 4,
              textDecoration: 'none',
              color: '#333',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLElement).style.backgroundColor = '#e0e0e0';
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLElement).style.backgroundColor = '#f0f0f0';
            }}
          >
            Open Default Document
          </a>
        </div>

        <div style={{
          borderTop: '1px solid #ccc',
          paddingTop: 20,
        }}>
          <h3>Create a new document</h3>
          <div style={{
            display: 'flex',
            gap: 8,
            marginBottom: 12,
          }}>
            <input
              type="text"
              placeholder="Document name"
              value={newDocName}
              onChange={(e) => this.setState({ newDocName: e.target.value })}
              onKeyPress={this.handleKeyPress}
              disabled={creating}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: 4,
                border: '1px solid #ccc',
                fontSize: 14,
              }}
            />
            <button
              onClick={this.handleCreate}
              disabled={!newDocName.trim() || creating}
              style={{
                padding: '8px 16px',
                borderRadius: 4,
                border: 'none',
                backgroundColor: '#007bff',
                color: 'white',
                cursor: creating ? 'not-allowed' : 'pointer',
                opacity: (!newDocName.trim() || creating) ? 0.5 : 1,
              }}
            >
              {creating ? 'Creating...' : 'Create'}
            </button>
          </div>
          <p style={{ fontSize: 12, opacity: 0.6 }}>
            Enter a name and click Create to open a new document.
          </p>
        </div>
      </div>
    );
  }
}
