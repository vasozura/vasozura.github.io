import type { Language } from "../i18n";

export const learningCopy = {
  en: {
    title: "Learning mode", clock: "One canonical score clock drives sound, cursor, instruments, metronome and loops.", checking: "Checking score/MIDI alignment…",
    play: "Play", pause: "Pause", stop: "Stop", metronome: "Metronome", tempo: "Tempo", position: "Position", loopFrom: "Loop from measure", to: "to", setLoop: "Set loop", clearLoop: "Clear loop",
    instrumentView: "Instrument view", piano: "Piano", guitar: "Guitar / TAB", accordion: "Accordion", follow: "Follow current note", leftHanded: "Left-handed guitar", current: "Current", upcoming: "Upcoming",
    practice: "Practice exercise", instrument: "Instrument", fromMeasure: "From measure", toMeasure: "To measure", difficulty: "Difficulty", beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced",
    countdown: "Countdown", off: "Off", beats2: "2 beats", beats4: "4 beats", practiceMode: "Practice mode", listen: "Listen", waitForNote: "Wait for note (Web MIDI)", continuous: "Continuous",
    prepare: "Prepare exercise", connectMidi: "Connect MIDI input", startPractice: "Start practice", finishScore: "Finish & score", reset: "Reset my learning history",
    scoring: "Scoring compares recorded MIDI pitch, onset and duration against the immutable exercise timeline using the API's versioned deterministic tolerances.", preparing: "Preparing canonical timeline…",
    startingIn: "Starting in", apiConnected: "Learning API connected.", apiFallback: "Learning API unavailable; using the versioned local adapter.", localAdapter: "Using the versioned local learning adapter.",
    attempts: "Attempts", best: "best", recent: "recent", streak: "streak", noAttempts: "No attempts recorded yet.", recentAttempts: "Recent attempts", signInProgress: "Sign in to save private progress.",
    noteFeedback: "Note feedback", measure: "measure", beat: "beat", expected: "expected", played: "played", exerciseReady: "Exercise ready", generating: "Generating deterministic exercise…",
    resetConfirm: "Delete only your attempts and progress for this song? This cannot be undone.", deleted: "Deleted", and: "and", progressEntries: "progress entries", attempt: "attempt", attemptsPlural: "attempts",
    pitch: "Pitch", timing: "timing", completion: "completion", midiConnected: "MIDI connected", prepareRetry: "Select Prepare exercise to retry safely.", listenStarted: "Listen mode started.", midiFallback: "Web MIDI is unavailable; continuous fallback started.", practiceStarted: "Practice recording started.", evaluating: "Evaluating attempt…", timingPaused: "Timing score paused because the tab was throttled.", finishRetry: "You can finish again to retry safely.", progressRetry: "Progress can be retried after reconnecting.",
    syncHigh: "HIGH synchronization · Score and MIDI timing are aligned.", syncMedium: "MEDIUM synchronization · Small score/MIDI timing differences are normalized to the canonical timeline.", syncUnreliable: "UNRELIABLE synchronization · Canonical score timing is used.",
  },
  ka: {
    title: "სწავლის რეჟიმი", clock: "ხმა, სანოტო კურსორი, ინსტრუმენტები, მეტრონომი და ციკლი ერთ კანონიკურ საათს მიჰყვება.", checking: "ნოტებისა და MIDI-ს სინქრონიზაციის შემოწმება…",
    play: "დაკვრა", pause: "პაუზა", stop: "გაჩერება", metronome: "მეტრონომი", tempo: "ტემპი", position: "პოზიცია", loopFrom: "ციკლი ზომიდან", to: "მდე", setLoop: "ციკლის დაყენება", clearLoop: "ციკლის გაუქმება",
    instrumentView: "ინსტრუმენტის ხედი", piano: "ფორტეპიანო", guitar: "გიტარა / TAB", accordion: "აკორდეონი", follow: "მიმდინარე ნოტის მიყოლა", leftHanded: "მარცხენახელიანი გიტარა", current: "მიმდინარე", upcoming: "შემდეგი",
    practice: "სავარჯიშო", instrument: "ინსტრუმენტი", fromMeasure: "ზომიდან", toMeasure: "ზომამდე", difficulty: "სირთულე", beginner: "დამწყები", intermediate: "საშუალო", advanced: "რთული",
    countdown: "ათვლა", off: "გამორთული", beats2: "2 დარტყმა", beats4: "4 დარტყმა", practiceMode: "ვარჯიშის რეჟიმი", listen: "მოსმენა", waitForNote: "ნოტის მოლოდინი (Web MIDI)", continuous: "უწყვეტი",
    prepare: "სავარჯიშოს მომზადება", connectMidi: "MIDI შესასვლელის დაკავშირება", startPractice: "ვარჯიშის დაწყება", finishScore: "დასრულება და შეფასება", reset: "ჩემი სწავლის ისტორიის წაშლა",
    scoring: "შეფასება ჩაწერილ MIDI სიმაღლეს, დაწყებასა და ხანგრძლივობას ადარებს უცვლელ სავარჯიშო timeline-ს API-ის ვერსირებულ, დეტერმინისტულ ზღვრებში.", preparing: "კანონიკური timeline-ის მომზადება…",
    startingIn: "დაწყებამდე", apiConnected: "Learning API დაკავშირებულია.", apiFallback: "Learning API მიუწვდომელია; გამოიყენება ვერსირებული ლოკალური ადაპტერი.", localAdapter: "გამოიყენება ვერსირებული ლოკალური სასწავლო ადაპტერი.",
    attempts: "მცდელობა", best: "საუკეთესო", recent: "ბოლო", streak: "სერია", noAttempts: "მცდელობა ჯერ არ არის.", recentAttempts: "ბოლო მცდელობები", signInProgress: "პირადი პროგრესის შესანახად შედით ანგარიშში.",
    noteFeedback: "ნოტების უკუკავშირი", measure: "ზომა", beat: "დარტყმა", expected: "მოსალოდნელი", played: "დაკრული", exerciseReady: "სავარჯიშო მზადაა", generating: "დეტერმინისტული სავარჯიშოს შექმნა…",
    resetConfirm: "წაიშალოს მხოლოდ თქვენი მცდელობები და ამ სიმღერის პროგრესი? მოქმედება შეუქცევადია.", deleted: "წაიშალა", and: "და", progressEntries: "პროგრესის ჩანაწერი", attempt: "მცდელობა", attemptsPlural: "მცდელობა",
    pitch: "ნოტის სიზუსტე", timing: "დროის სიზუსტე", completion: "შესრულება", midiConnected: "MIDI დაკავშირებულია", prepareRetry: "უსაფრთხო გამეორებისთვის კვლავ მოამზადეთ სავარჯიშო.", listenStarted: "მოსმენის რეჟიმი დაიწყო.", midiFallback: "Web MIDI მიუწვდომელია; დაიწყო უწყვეტი სარეზერვო რეჟიმი.", practiceStarted: "ვარჯიშის ჩაწერა დაიწყო.", evaluating: "მცდელობის შეფასება…", timingPaused: "დროის შეფასება შეჩერდა, რადგან ჩანართი შეფერხდა.", finishRetry: "უსაფრთხო გამეორებისთვის შეფასება კვლავ დაასრულეთ.", progressRetry: "კავშირის აღდგენის შემდეგ პროგრესის მოთხოვნა შეიძლება განმეორდეს.",
    syncHigh: "მაღალი სინქრონიზაცია · ნოტებისა და MIDI-ს დრო თანხვდება.", syncMedium: "საშუალო სინქრონიზაცია · მცირე სხვაობა კანონიკურ timeline-ზე ნორმალიზდება.", syncUnreliable: "არასანდო სინქრონიზაცია · გამოიყენება კანონიკური ნოტების დრო.",
  },
} as const satisfies Record<Language, Record<string, string>>;

export function getLearningCopy(language: Language) { return learningCopy[language]; }
