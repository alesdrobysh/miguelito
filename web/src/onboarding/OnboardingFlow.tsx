import { useApp } from '../context/AppContext'
import { WelcomeStep } from './WelcomeStep'
import { ProfileStep } from './ProfileStep'
import { ModelStep } from './ModelStep'
import { DownloadStep } from './DownloadStep'
import type { OnboardingStep } from '../context/AppContext'

interface OnboardingFlowProps {
  step: OnboardingStep
}

export function OnboardingFlow({ step }: OnboardingFlowProps) {
  const { advanceToProfile, saveProfileAndAdvance, downloadAndStart, startWithOpenRouter } = useApp()

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <div className="mx-auto w-full max-w-md flex-1">
        {step === 'welcome' && <WelcomeStep onNext={advanceToProfile} />}
        {step === 'profile' && <ProfileStep onSave={saveProfileAndAdvance} />}
        {step === 'model' && (
          <ModelStep
            onSelectWebLLM={downloadAndStart}
            onSelectOpenRouter={startWithOpenRouter}
          />
        )}
        {step === 'download' && <DownloadStep />}
      </div>
    </div>
  )
}
