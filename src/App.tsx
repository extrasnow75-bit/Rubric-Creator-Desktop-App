import React from 'react';
import { SessionProvider, useSession } from './contexts/SessionContext';
import { DrivePickerProvider } from './contexts/DrivePickerContext';
import { Layout } from './components/Layout';
import { Dashboard } from './components/Dashboard';
import { Part1Rubric } from './components/Part1Rubric';
import { Part2WordToCsv } from './components/Part2WordToCsv';
import { Part3Upload } from './components/Part3Upload';
import { ScreenshotConverter } from './components/ScreenshotConverter';
import HelpCenter from './components/HelpCenter';
import ProgressDisplay from './components/ProgressDisplay';
import TaskCompletionDialog from './components/TaskCompletionDialog';
import { AppMode } from './types';

const AppContent: React.FC = () => {
  const {
    state,
    setHelpOpen,
    setTaskCompletionOpen,
    setCurrentStep,
    newBatch,
    clearSession,
    stopProgress,
  } = useSession();

  /**
   * `key` is what makes Start Over actually start over.
   *
   * Each screen keeps local state this context cannot see — the Dashboard alone holds the
   * uploaded-file queue, the chosen Phase 1 mode and the answer to the draft-rubric question.
   * Clearing the session reset the context and left every one of those untouched, so the screen
   * carried on looking exactly as it had. Remounting on a changed key resets all of it at once,
   * and keeps working as screens gain state nobody remembered to list here.
   */
  const renderContent = () => {
    switch (state.currentStep) {
      case AppMode.DASHBOARD:
        return <Dashboard />;
      case AppMode.PART_1:
        return <Part1Rubric />;
      case AppMode.PART_2:
        return <Part2WordToCsv />;
      case AppMode.PART_3:
        return <Part3Upload />;
      case AppMode.SCREENSHOT:
        return <ScreenshotConverter />;
      default:
        return <Dashboard />;
    }
  };

  const handleTaskContinue = () => {
    setTaskCompletionOpen(false);
    if (state.currentStep === AppMode.PART_1) {
      setCurrentStep(AppMode.PART_2);
    } else if (state.currentStep === AppMode.PART_2) {
      setCurrentStep(AppMode.PART_3);
    }
  };

  const handleNewBatch = () => {
    setTaskCompletionOpen(false);
    newBatch();
    if (state.currentStep === AppMode.PART_1 || state.currentStep === AppMode.SCREENSHOT) {
      // Stay in Part 1 or Screenshot for new batch
    } else if (state.currentStep === AppMode.PART_2) {
      setCurrentStep(AppMode.PART_1);
    } else if (state.currentStep === AppMode.PART_3) {
      setCurrentStep(AppMode.PART_2);
    }
  };

  const handleNewSession = () => {
    setTaskCompletionOpen(false);
    clearSession();
    setCurrentStep(AppMode.DASHBOARD);
  };

  return (
    <>
      <Layout>
        <React.Fragment key={state.sessionKey}>{renderContent()}</React.Fragment>
        <HelpCenter isOpen={state.helpOpen} onClose={() => setHelpOpen(false)} />
      </Layout>
      <ProgressDisplay progress={state.progress} onStop={stopProgress} />
      <TaskCompletionDialog
        isOpen={state.taskCompletionOpen}
        currentStep={state.currentStep}
        onContinue={handleTaskContinue}
        onNewBatch={handleNewBatch}
        onNewSession={handleNewSession}
        onClose={() => setTaskCompletionOpen(false)}
      />
    </>
  );
};

const App: React.FC = () => {
  return (
    <SessionProvider>
      <DrivePickerProvider>
        <AppContent />
      </DrivePickerProvider>
    </SessionProvider>
  );
};

export default App;
