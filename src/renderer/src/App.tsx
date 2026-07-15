import { useState } from 'react'
import { useFriday } from './hooks/useFriday'
import { Orb } from './components/Orb'
import { CommandBar } from './components/CommandBar'
import { ConversationPanel } from './components/ConversationPanel'
import { TaskPanel } from './components/TaskPanel'
import { ActivityHistory } from './components/ActivityHistory'
import { SettingsPanel } from './components/SettingsPanel'
import { PermissionsPanel } from './components/PermissionsPanel'
import { ConfirmDialog } from './components/ConfirmDialog'

type Tab = 'history' | 'settings' | 'permissions'

function App(): React.JSX.Element {
  const friday = useFriday()
  const [tab, setTab] = useState<Tab>('history')

  return (
    <div className="app">
      <header className="app__header">
        <Orb status={friday.status} onPress={() => {}} />
      </header>

      <main className="app__main">
        <section className="app__column">
          <ConversationPanel turns={friday.conversation} />
          <CommandBar onSubmit={friday.sendText} />
          <TaskPanel
            task={friday.task}
            status={friday.status}
            onPause={friday.pause}
            onContinue={friday.continueTask}
            onStop={friday.stop}
          />
        </section>

        <section className="app__sidebar">
          <nav className="tabs">
            <button
              className={tab === 'history' ? 'tabs__tab tabs__tab--active' : 'tabs__tab'}
              onClick={() => setTab('history')}
            >
              History
            </button>
            <button
              className={tab === 'settings' ? 'tabs__tab tabs__tab--active' : 'tabs__tab'}
              onClick={() => setTab('settings')}
            >
              Settings
            </button>
            <button
              className={tab === 'permissions' ? 'tabs__tab tabs__tab--active' : 'tabs__tab'}
              onClick={() => setTab('permissions')}
            >
              Permissions
            </button>
          </nav>
          {tab === 'history' && (
            <ActivityHistory entries={friday.history} onClear={friday.clearHistory} />
          )}
          {tab === 'settings' && (
            <SettingsPanel settings={friday.settings} onChange={friday.updateSettings} />
          )}
          {tab === 'permissions' && (
            <PermissionsPanel
              permissions={friday.permissions}
              onRefresh={friday.refreshPermissions}
            />
          )}
        </section>
      </main>

      <ConfirmDialog request={friday.confirmRequest} onResolve={friday.resolveConfirm} />
    </div>
  )
}

export default App
