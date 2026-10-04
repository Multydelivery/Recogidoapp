import { Header } from "@/components/Header";
import { Hero } from "@/components/Hero";
import { HowItWorks } from "@/components/HowItWorks";
import { Services } from "@/components/Services";
import { ForBusinesses } from "@/components/ForBusinesses";
import { ForDrivers } from "@/components/ForDrivers";
import { ContactForm } from "@/components/ContactForm";
import { Privacy } from "@/components/Privacy";
import { Terms } from "@/components/Terms";
import { Footer } from "@/components/Footer";

export default function Home() {
  return (
    <>
      <Header />
      <main className="flex-1">
        <Hero />
        <HowItWorks />
        <Services />
        <ForBusinesses />
        <ForDrivers />
        <ContactForm />
        <Privacy />
        <Terms />
      </main>
      <Footer />
    </>
  );
}
