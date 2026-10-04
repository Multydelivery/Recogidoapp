export type Language = "en" | "es";

export interface Translations {
  nav: {
    home: string;
    howItWorks: string;
    services: string;
    contact: string;
    callDispatch: string;
  };
  hero: {
    headline: string;
    subtext: string;
    callDispatch: string;
    emailUs: string;
    caption1: string;
    caption2: string;
    caption3: string;
  };
  howItWorks: {
    title: string;
    step1Title: string;
    step1Desc: string;
    step2Title: string;
    step2Desc: string;
    step3Title: string;
    step3Desc: string;
    disclaimer: string;
  };
  services: {
    title: string;
    card1Title: string;
    card1Desc: string;
    card2Title: string;
    card2Desc: string;
    card3Title: string;
    card3Desc: string;
  };
  forBusinesses: {
    title: string;
    desc: string;
    cta: string;
  };
  forDrivers: {
    title: string;
    desc: string;
  };
  contact: {
    title: string;
    phoneLabel: string;
    emailLabel: string;
    websiteLabel: string;
    serviceTypeLabel: string;
    serviceTypeValue: string;
    formTitle: string;
    formName: string;
    formBusiness: string;
    formPhone: string;
    formEmail: string;
    formMessage: string;
    consentText: string;
    submit: string;
    successMessage: string;
  };
  messagingConsent: {
    text: string;
  };
  privacy: {
    title: string;
    intro: string;
    collectTitle: string;
    collectDesc: string;
    useTitle: string;
    useDesc: string;
    noSellTitle: string;
    noSellDesc: string;
    providersTitle: string;
    providersDesc: string;
    rightsTitle: string;
    rightsDesc: string;
    contactLine: string;
  };
  terms: {
    title: string;
    p1: string;
    p2: string;
    p3: string;
    p4: string;
    p5: string;
    p6: string;
    attorneyNotice: string;
    contactLine: string;
  };
  footer: {
    tagline: string;
    privacyLink: string;
    termsLink: string;
    operatedBy: string;
    rightsReserved: string;
  };
}

export const translations: Record<Language, Translations> = {
  en: {
    nav: {
      home: "Home",
      howItWorks: "How It Works",
      services: "Services",
      contact: "Contact",
      callDispatch: "Call Dispatch",
    },
    hero: {
      headline: "Simple, dependable dispatch communication",
      subtext:
        "Recogido helps businesses coordinate delivery requests by phone and messaging, providing a simple point of contact between participating businesses, dispatchers, and independent drivers.",
      callDispatch: "Call Dispatch",
      emailUs: "Email Us",
      caption1: "Restaurant calls dispatch",
      caption2: "Dispatch sends a notification",
      caption3: "Available driver responds",
    },
    howItWorks: {
      title: "How It Works",
      step1Title: "Call",
      step1Desc:
        "A participating business calls the Recogido dispatch number and enters the number of delivery requests.",
      step2Title: "Notify",
      step2Desc:
        "The dispatch system records the request and sends a notification to the dispatcher or participating drivers.",
      step3Title: "Respond",
      step3Desc: "An available independent driver can respond to the notification.",
      disclaimer:
        "Recogido provides communication and dispatch coordination only. Transportation and delivery services are performed by independent third parties.",
    },
    services: {
      title: "Services",
      card1Title: "Phone Request Intake",
      card1Desc: "Businesses call in delivery requests directly, no app or long forms required.",
      card2Title: "Dispatch Notifications",
      card2Desc: "Requests are recorded and relayed to dispatchers and available drivers in real time.",
      card3Title: "Driver Availability Coordination",
      card3Desc: "Independent drivers are notified of open requests and choose whether to respond.",
    },
    forBusinesses: {
      title: "For Businesses",
      desc:
        "Restaurants and participating businesses can submit delivery requests with a simple phone call, no long online forms required.",
      cta: "Call Dispatch",
    },
    forDrivers: {
      title: "For Drivers",
      desc:
        "Participating independent drivers may receive availability notifications and decide whether to respond. Responding is voluntary, and work, assignments, and compensation are never guaranteed.",
    },
    contact: {
      title: "Contact",
      phoneLabel: "Phone",
      emailLabel: "Email",
      websiteLabel: "Website",
      serviceTypeLabel: "Service Type",
      serviceTypeValue: "Remote dispatch and communication coordination",
      formTitle: "Send Us a Message",
      formName: "Name",
      formBusiness: "Business Name",
      formPhone: "Phone",
      formEmail: "Email",
      formMessage: "Message",
      consentText:
        "I agree that Recogido may contact me regarding my inquiry. Message and data rates may apply. Consent is not a condition of purchase.",
      submit: "Send Message",
      successMessage:
        "Thanks — this is a demo form. No message was actually sent. Connect a form service to enable delivery (see README).",
    },
    messagingConsent: {
      text: "By choosing to receive messages, users agree to receive dispatch-related notifications from Recogido. Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for assistance.",
    },
    privacy: {
      title: "Privacy Policy",
      intro: "This Privacy Policy explains how Recogido collects and uses information.",
      collectTitle: "Information We Collect",
      collectDesc:
        "We may collect names, business names, phone numbers, email addresses, and messages submitted through our contact form or phone calls.",
      useTitle: "How We Use Information",
      useDesc:
        "Information is used to coordinate dispatch communication, respond to inquiries, and provide customer support.",
      noSellTitle: "We Do Not Sell Information",
      noSellDesc: "Recogido does not sell personal information to third parties.",
      providersTitle: "Service Providers",
      providersDesc:
        "Trusted third-party service providers, such as communications or hosting providers, may process information on our behalf to help operate our services.",
      rightsTitle: "Your Rights",
      rightsDesc: "You may request access, correction, or deletion of your information by contacting us.",
      contactLine: "Questions about this policy can be sent to",
    },
    terms: {
      title: "Terms of Service",
      p1: "Recogido provides dispatch and communication coordination services only.",
      p2: "Recogido is not a transportation carrier and does not provide delivery or transportation services.",
      p3: "Delivery and transportation services are performed by independent drivers and third parties who are not employees or agents of Recogido.",
      p4: "Service availability is not guaranteed and may vary based on driver availability.",
      p5: "Users are responsible for providing accurate and current information when contacting Recogido.",
      p6: "This website may not be used for any unlawful purpose.",
      attorneyNotice:
        "These Terms of Service and the Privacy Policy are provided as a general starting point and should be reviewed by a qualified attorney before production launch.",
      contactLine: "Questions about these terms can be sent to",
    },
    footer: {
      tagline: "Remote phone dispatch and communication services",
      privacyLink: "Privacy Policy",
      termsLink: "Terms of Service",
      operatedBy: "Operated by",
      rightsReserved: "All rights reserved.",
    },
  },
  es: {
    nav: {
      home: "Inicio",
      howItWorks: "Cómo Funciona",
      services: "Servicios",
      contact: "Contacto",
      callDispatch: "Llamar a Despacho",
    },
    hero: {
      headline: "Comunicación de despacho simple y confiable",
      subtext:
        "Recogido ayuda a las empresas a coordinar solicitudes de entrega por teléfono y mensajería, brindando un punto de contacto simple entre las empresas participantes, los despachadores y los conductores independientes.",
      callDispatch: "Llamar a Despacho",
      emailUs: "Enviar Correo",
      caption1: "El restaurante llama a despacho",
      caption2: "Despacho envía una notificación",
      caption3: "Un conductor disponible responde",
    },
    howItWorks: {
      title: "Cómo Funciona",
      step1Title: "Llamar",
      step1Desc:
        "Una empresa participante llama al número de despacho de Recogido e indica la cantidad de solicitudes de entrega.",
      step2Title: "Notificar",
      step2Desc:
        "El sistema de despacho registra la solicitud y envía una notificación al despachador o a los conductores participantes.",
      step3Title: "Responder",
      step3Desc: "Un conductor independiente disponible puede responder a la notificación.",
      disclaimer:
        "Recogido solo proporciona comunicación y coordinación de despacho. Los servicios de transporte y entrega son realizados por terceros independientes.",
    },
    services: {
      title: "Servicios",
      card1Title: "Recepción de Solicitudes por Teléfono",
      card1Desc: "Las empresas llaman para solicitar entregas directamente, sin necesidad de una aplicación ni formularios largos.",
      card2Title: "Notificaciones de Despacho",
      card2Desc: "Las solicitudes se registran y se transmiten a los despachadores y conductores disponibles en tiempo real.",
      card3Title: "Coordinación de Disponibilidad de Conductores",
      card3Desc: "Los conductores independientes son notificados de las solicitudes abiertas y deciden si responder.",
    },
    forBusinesses: {
      title: "Para Empresas",
      desc:
        "Los restaurantes y las empresas participantes pueden enviar solicitudes de entrega con una simple llamada telefónica, sin necesidad de completar formularios en línea extensos.",
      cta: "Llamar a Despacho",
    },
    forDrivers: {
      title: "Para Conductores",
      desc:
        "Los conductores independientes participantes pueden recibir notificaciones de disponibilidad y decidir si responder. Responder es voluntario, y el trabajo, las asignaciones y la compensación nunca están garantizados.",
    },
    contact: {
      title: "Contacto",
      phoneLabel: "Teléfono",
      emailLabel: "Correo Electrónico",
      websiteLabel: "Sitio Web",
      serviceTypeLabel: "Tipo de Servicio",
      serviceTypeValue: "Coordinación remota de despacho y comunicación",
      formTitle: "Envíanos un Mensaje",
      formName: "Nombre",
      formBusiness: "Nombre del Negocio",
      formPhone: "Teléfono",
      formEmail: "Correo Electrónico",
      formMessage: "Mensaje",
      consentText:
        "Acepto que Recogido pueda contactarme sobre mi consulta. Pueden aplicarse tarifas de mensajes y datos. El consentimiento no es una condición de compra.",
      submit: "Enviar Mensaje",
      successMessage:
        "Gracias — este es un formulario de demostración. No se envió ningún mensaje. Conecte un servicio de formularios para habilitar el envío (ver README).",
    },
    messagingConsent: {
      text: "Al elegir recibir mensajes, los usuarios aceptan recibir notificaciones relacionadas con el despacho de Recogido. La frecuencia de los mensajes varía. Pueden aplicarse tarifas de mensajes y datos. Responda STOP para cancelar la suscripción o HELP para obtener ayuda.",
    },
    privacy: {
      title: "Política de Privacidad",
      intro: "Esta Política de Privacidad explica cómo Recogido recopila y utiliza la información.",
      collectTitle: "Información que Recopilamos",
      collectDesc:
        "Podemos recopilar nombres, nombres de negocios, números de teléfono, direcciones de correo electrónico y mensajes enviados a través de nuestro formulario de contacto o llamadas telefónicas.",
      useTitle: "Cómo Usamos la Información",
      useDesc:
        "La información se utiliza para coordinar la comunicación de despacho, responder consultas y brindar atención al cliente.",
      noSellTitle: "No Vendemos Información",
      noSellDesc: "Recogido no vende información personal a terceros.",
      providersTitle: "Proveedores de Servicios",
      providersDesc:
        "Proveedores de servicios de terceros de confianza, como proveedores de comunicaciones u hospedaje, pueden procesar información en nuestro nombre para ayudar a operar nuestros servicios.",
      rightsTitle: "Sus Derechos",
      rightsDesc: "Puede solicitar acceso, corrección o eliminación de su información contactándonos.",
      contactLine: "Las preguntas sobre esta política pueden enviarse a",
    },
    terms: {
      title: "Términos de Servicio",
      p1: "Recogido solo proporciona servicios de coordinación de despacho y comunicación.",
      p2: "Recogido no es un transportista y no brinda servicios de entrega o transporte.",
      p3: "Los servicios de entrega y transporte son realizados por conductores independientes y terceros que no son empleados ni agentes de Recogido.",
      p4: "La disponibilidad del servicio no está garantizada y puede variar según la disponibilidad de los conductores.",
      p5: "Los usuarios son responsables de proporcionar información precisa y actualizada al contactar a Recogido.",
      p6: "Este sitio web no puede utilizarse para ningún propósito ilegal.",
      attorneyNotice:
        "Estos Términos de Servicio y la Política de Privacidad se proporcionan como un punto de partida general y deben ser revisados por un abogado calificado antes del lanzamiento en producción.",
      contactLine: "Las preguntas sobre estos términos pueden enviarse a",
    },
    footer: {
      tagline: "Servicios remotos de despacho telefónico y comunicación",
      privacyLink: "Política de Privacidad",
      termsLink: "Términos de Servicio",
      operatedBy: "Operado por",
      rightsReserved: "Todos los derechos reservados.",
    },
  },
};
