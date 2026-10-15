// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, the reports of the Configuration actions, scene
// action errors. Four languages, the four of the Gladys interface; German
// says "du", Spanish "usted". test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './ipwebcam/client.js';

export const LANGUAGE_FALLBACK = 'en';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noHost: {
    en: 'Enter the address of your phones running IP Webcam in the configuration.',
    fr: "Saisissez l'adresse de vos téléphones qui font tourner IP Webcam dans la configuration.",
    de: 'Gib die Adresse deiner Handys mit IP Webcam in der Konfiguration ein.',
    es: 'Introduzca la dirección de sus teléfonos con IP Webcam en la configuración.',
  },
  invalidHost: {
    en: 'Address not understood, e.g. 192.168.1.50 (no password in the address).',
    fr: "Adresse incomprise, ex. 192.168.1.50 (pas de mot de passe dans l'adresse).",
    de: 'Adresse nicht verstanden, z. B. 192.168.1.50 (kein Passwort in der Adresse).',
    es: 'Dirección no válida, p. ej. 192.168.1.50 (sin contraseña en la dirección).',
  },
  credentials: {
    en: 'IP Webcam needs both a user name and a password, or neither: complete the configuration.',
    fr: "IP Webcam demande un nom d'utilisateur et un mot de passe, ou aucun des deux : complétez la configuration.",
    de: 'IP Webcam braucht Benutzername und Passwort oder keins von beiden: Vervollständige die Konfiguration.',
    es: 'IP Webcam necesita un nombre de usuario y una contraseña, o ninguno: complete la configuración.',
  },
  someDown: {
    en: 'Connected, but some phones do not answer: see the integration logs.',
    fr: "Connectée, mais certains téléphones ne répondent pas : voir les logs de l'intégration.",
    de: 'Verbunden, aber einige Handys antworten nicht: Sieh dir die Protokolle der Integration an.',
    es: 'Conectada, pero algunos teléfonos no responden: consulte los registros de la integración.',
  },
};

// One explanation per error kind (src/ipwebcam/client.js), shown in the
// connection status, the reports and the failed commands.
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'The phone does not answer: check its address, that IP Webcam is started and that Gladys can reach it.',
    fr: "Le téléphone ne répond pas : vérifiez son adresse, qu'IP Webcam est démarré et que Gladys peut l'atteindre.",
    de: 'Das Handy antwortet nicht: Prüfe seine Adresse, ob IP Webcam läuft und ob Gladys es erreicht.',
    es: 'El teléfono no responde: compruebe su dirección, que IP Webcam esté iniciado y que Gladys pueda alcanzarlo.',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'User name or password refused: check them in the configuration and in IP Webcam.',
    fr: "Nom d'utilisateur ou mot de passe refusé : vérifiez-les dans la configuration et dans IP Webcam.",
    de: 'Benutzername oder Passwort abgelehnt: Prüfe sie in der Konfiguration und in IP Webcam.',
    es: 'Nombre de usuario o contraseña rechazados: compruébelos en la configuración y en IP Webcam.',
  },
  [ERROR_KINDS.NOT_IPWEBCAM]: {
    en: 'Something answers at this address, but not IP Webcam: check the address and the port.',
    fr: "Quelque chose répond à cette adresse, mais pas IP Webcam : vérifiez l'adresse et le port.",
    de: 'Unter dieser Adresse antwortet etwas, aber nicht IP Webcam: Prüfe Adresse und Port.',
    es: 'Algo responde en esta dirección, pero no IP Webcam: compruebe la dirección y el puerto.',
  },
  [ERROR_KINDS.REFUSED]: {
    en: 'The app refused the command: this phone may not support it.',
    fr: "L'application a refusé la commande : ce téléphone ne la prend peut-être pas en charge.",
    de: 'Die App hat den Befehl abgelehnt: Dieses Handy unterstützt ihn vielleicht nicht.',
    es: 'La aplicación rechazó la orden: puede que este teléfono no la admita.',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'The app refused the request: see the integration logs.',
    fr: "L'application a refusé la requête : voir les logs de l'intégration.",
    de: 'Die App hat die Anfrage abgelehnt: Sieh dir die Protokolle der Integration an.',
    es: 'La aplicación rechazó la solicitud: consulte los registros de la integración.',
  },
};

// Report of the "Test the connection" action, one line per phone.
export const REPORT_TEXT = {
  en: {
    ok: (host, sensors, settings) =>
      `${host}: IP Webcam answers, ${sensors} sensor(s) logged, ${settings} setting(s) controllable.`,
    noSensor: (host) =>
      `${host}: IP Webcam answers, but logs no sensor: enable "Data logging" in the app.`,
    failed: (host, reason) => `${host}: ${reason}`,
  },
  fr: {
    ok: (host, sensors, settings) =>
      `${host} : IP Webcam répond, ${sensors} capteur(s) enregistré(s), ${settings} réglage(s) pilotable(s).`,
    noSensor: (host) =>
      `${host} : IP Webcam répond, mais n'enregistre aucun capteur : activez « Data logging » dans l'application.`,
    failed: (host, reason) => `${host} : ${reason}`,
  },
  de: {
    ok: (host, sensors, settings) =>
      `${host}: IP Webcam antwortet, ${sensors} Sensor(en) aufgezeichnet, ${settings} Einstellung(en) steuerbar.`,
    noSensor: (host) =>
      `${host}: IP Webcam antwortet, zeichnet aber keinen Sensor auf: Aktiviere „Data logging“ in der App.`,
    failed: (host, reason) => `${host}: ${reason}`,
  },
  es: {
    ok: (host, sensors, settings) =>
      `${host}: IP Webcam responde, ${sensors} sensor(es) registrado(s), ${settings} ajuste(s) controlable(s).`,
    noSensor: (host) =>
      `${host}: IP Webcam responde, pero no registra ningún sensor: active «Data logging» en la aplicación.`,
    failed: (host, reason) => `${host}: ${reason}`,
  },
};

// Messages of the Configuration actions, the scene actions and the widget.
export const ACTION_TEXT = {
  notConfigured: {
    en: 'Configure the address of a phone running IP Webcam first.',
    fr: "Configurez d'abord l'adresse d'un téléphone qui fait tourner IP Webcam.",
    de: 'Konfiguriere zuerst die Adresse eines Handys mit IP Webcam.',
    es: 'Configure primero la dirección de un teléfono con IP Webcam.',
  },
  pickPhone: {
    en: 'Choose a phone added to Gladys.',
    fr: 'Choisissez un téléphone ajouté à Gladys.',
    de: 'Wähle ein Handy, das zu Gladys hinzugefügt wurde.',
    es: 'Elija un teléfono añadido a Gladys.',
  },
  unknownPhone: {
    en: 'This device is not (or no longer) one of the configured phones.',
    fr: "Cet appareil n'est pas (ou plus) un des téléphones configurés.",
    de: 'Dieses Gerät gehört nicht (mehr) zu den konfigurierten Handys.',
    es: 'Este dispositivo no es (o ya no es) uno de los teléfonos configurados.',
  },
  snapshotFailed: {
    en: 'The phone did not send an image.',
    fr: "Le téléphone n'a pas envoyé d'image.",
    de: 'Das Handy hat kein Bild gesendet.',
    es: 'El teléfono no envió ninguna imagen.',
  },
  motionOffDisabled: {
    en: 'Turning the motion detection off is disabled: allow it in the configuration of the integration first.',
    fr: "La coupure de la détection de mouvement est désactivée : autorisez-la d'abord dans la configuration de l'intégration.",
    de: 'Das Ausschalten der Bewegungserkennung ist deaktiviert: Erlaube es zuerst in der Konfiguration der Integration.',
    es: 'Desactivar la detección de movimiento está deshabilitado: autorícelo primero en la configuración de la integración.',
  },
  noMotionDetection: {
    en: 'This phone does not offer motion detection.',
    fr: 'Ce téléphone ne propose pas la détection de mouvement.',
    de: 'Dieses Handy bietet keine Bewegungserkennung.',
    es: 'Este teléfono no ofrece detección de movimiento.',
  },
  noTorch: {
    en: 'This phone has no torch the app can drive.',
    fr: "Ce téléphone n'a pas de lampe torche pilotable par l'application.",
    de: 'Dieses Handy hat keine Taschenlampe, die die App steuern kann.',
    es: 'Este teléfono no tiene linterna que la aplicación pueda controlar.',
  },
  stream: {
    en: 'For the "RTSP camera" integration of Gladys (replace PASSWORD, or remove "user:PASSWORD@" without login):',
    fr: "Pour l'intégration « Caméra RTSP » de Gladys (remplacez PASSWORD, ou retirez « user:PASSWORD@ » sans identifiants) :",
    de: 'Für die Integration „RTSP-Kamera“ von Gladys (ersetze PASSWORD oder entferne „user:PASSWORD@“ ohne Anmeldung):',
    es: 'Para la integración «Cámara RTSP» de Gladys (sustituya PASSWORD, o quite «user:PASSWORD@» sin credenciales):',
  },
  recordingStarted: {
    en: 'Recording started.',
    fr: 'Enregistrement démarré.',
    de: 'Aufnahme gestartet.',
    es: 'Grabación iniciada.',
  },
  recordingStopped: {
    en: 'Recording stopped.',
    fr: 'Enregistrement arrêté.',
    de: 'Aufnahme beendet.',
    es: 'Grabación detenida.',
  },
  torchOn: {
    en: 'Torch on.',
    fr: 'Lampe torche allumée.',
    de: 'Taschenlampe an.',
    es: 'Linterna encendida.',
  },
  torchOff: {
    en: 'Torch off.',
    fr: 'Lampe torche éteinte.',
    de: 'Taschenlampe aus.',
    es: 'Linterna apagada.',
  },
  imageTaken: {
    en: 'Fresh image taken.',
    fr: 'Nouvelle image prise.',
    de: 'Neues Bild aufgenommen.',
    es: 'Nueva imagen tomada.',
  },
};

export const pick = (text, language) => text?.[language] ?? text?.[LANGUAGE_FALLBACK];

/** A multi-language object built by a function of the language. */
export const localized = (render) =>
  Object.fromEntries(['en', 'fr', 'de', 'es'].map((language) => [language, render(language)]));
