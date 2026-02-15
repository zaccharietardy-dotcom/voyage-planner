"use client";

import { PlaneIcon, WifiOff, ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export default function OfflinePage() {
  const router = useRouter();

  const handleGoBack = () => {
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push("/");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted/20">
      <div className="container max-w-2xl px-4">
        <div className="text-center space-y-8">
          {/* Animated icon */}
          <div className="relative inline-flex items-center justify-center">
            <div className="absolute inset-0 rounded-full bg-primary/10 animate-pulse" />
            <div className="relative p-8 rounded-full bg-primary/5 backdrop-blur-sm">
              <PlaneIcon className="w-20 h-20 text-primary" strokeWidth={1.5} />
              <div className="absolute top-2 right-2 p-2 rounded-full bg-destructive/90">
                <WifiOff className="w-5 h-5 text-destructive-foreground" strokeWidth={2} />
              </div>
            </div>
          </div>

          {/* Main message */}
          <div className="space-y-4">
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-foreground">
              Vous êtes hors ligne
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground max-w-md mx-auto">
              Vos voyages sauvegardés sont toujours accessibles. Reconnectez-vous pour accéder aux dernières mises à jour.
            </p>
          </div>

          {/* Features list */}
          <div className="grid gap-4 text-left max-w-md mx-auto mt-8">
            <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/50">
              <div className="p-2 rounded bg-primary/10 text-primary">
                <PlaneIcon className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold text-sm">Voyages en cache</h3>
                <p className="text-sm text-muted-foreground">
                  Consultez les itinéraires déjà visités
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/50">
              <div className="p-2 rounded bg-primary/10 text-primary">
                <WifiOff className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold text-sm">Mode déconnecté</h3>
                <p className="text-sm text-muted-foreground">
                  Navigation limitée disponible sans connexion
                </p>
              </div>
            </div>
          </div>

          {/* Action button */}
          <div className="pt-4">
            <Button
              onClick={handleGoBack}
              size="lg"
              className="gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              Retour à la page précédente
            </Button>
          </div>

          {/* Info text */}
          <p className="text-sm text-muted-foreground/60">
            Vérifiez votre connexion internet et réessayez
          </p>
        </div>
      </div>
    </div>
  );
}
