'use client';

import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Plane, Globe, Utensils, Landmark, Languages, Info, Banknote, Sun, Compass, AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n';
import { PremiumBackground } from '@/components/ui/PremiumBackground';
import { QuestionCard } from './QuestionCard';

// ── Fun facts database by destination keyword ──
// Each destination has 6-10 facts that rotate during generation.
// Falls back to generic travel facts for unknown destinations.

interface DestinationFact {
  icon: typeof Info;
  category: string; // e.g. "Histoire", "Langue", "Gastronomie"
  text: string;
}

const DESTINATION_FACTS: Record<string, DestinationFact[]> = {
  paris: [
    { icon: Landmark, category: 'Histoire', text: 'La Tour Eiffel devait être démontée après 20 ans. Elle a été sauvée parce qu\'elle servait d\'antenne radio.' },
    { icon: Utensils, category: 'Gastronomie', text: 'Paris compte plus de 40 000 restaurants. Le plus ancien, Le Procope, est ouvert depuis 1686.' },
    { icon: Languages, category: 'Culture', text: 'Le Louvre est le musée le plus visité au monde avec près de 10 millions de visiteurs par an.' },
    { icon: Info, category: 'Le saviez-vous ?', text: 'Il n\'y a qu\'un seul panneau STOP dans tout Paris, situé au sortir d\'une entreprise de construction du 16e.' },
    { icon: Globe, category: 'Transport', text: 'Le métro parisien transporte 4 millions de passagers par jour sur 16 lignes.' },
    { icon: Banknote, category: 'Budget', text: 'Une baguette tradition coûte en moyenne 1,20 EUR dans les boulangeries parisiennes.' },
    { icon: Landmark, category: 'Architecture', text: 'Les immeubles haussmanniens qui bordent les grands boulevards datent tous de la même période : 1853-1870.' },
    { icon: Sun, category: 'Météo', text: 'Paris bénéficie en moyenne de 1 660 heures d\'ensoleillement par an, soit environ 4h30 par jour.' },
  ],
  tokyo: [
    { icon: Languages, category: 'Langue', text: 'Le japonais utilise trois systèmes d\'écriture différents : hiragana, katakana et kanji.' },
    { icon: Utensils, category: 'Gastronomie', text: 'Tokyo possède plus d\'étoiles Michelin que n\'importe quelle autre ville au monde.' },
    { icon: Info, category: 'Le saviez-vous ?', text: 'Le croisement de Shibuya est traversé par 2 500 personnes à chaque changement de feu.' },
    { icon: Globe, category: 'Transport', text: 'Les trains japonais ont un retard moyen annuel de 18 secondes seulement.' },
    { icon: Landmark, category: 'Culture', text: 'Le sanctuaire Senso-ji à Asakusa est le plus ancien temple bouddhiste de Tokyo, fondé en 645.' },
    { icon: Banknote, category: 'Budget', text: 'Un bol de ramen dans un bon restaurant coûte entre 800 et 1 200 yens (5-8 EUR).' },
    { icon: Sun, category: 'Saison', text: 'La saison des cerisiers en fleur (sakura) dure environ 2 semaines, généralement fin mars-début avril.' },
    { icon: Info, category: 'Visa', text: 'Les ressortissants français peuvent séjourner au Japon jusqu\'à 90 jours sans visa.' },
  ],
  barcelona: [
    { icon: Landmark, category: 'Architecture', text: 'La Sagrada Familia est en construction depuis 1882. Sa date d\'achèvement est prévue pour 2026.' },
    { icon: Utensils, category: 'Gastronomie', text: 'Les tapas ne sont pas originaires de Barcelone mais d\'Andalousie. Ici, on mange plutôt des pintxos.' },
    { icon: Languages, category: 'Langue', text: 'Le catalan est la langue officielle de la Catalogne, parlée par 9 millions de personnes.' },
    { icon: Info, category: 'Le saviez-vous ?', text: 'La Rambla, l\'avenue la plus connue, mesure 1,2 km du centre-ville jusqu\'au port.' },
    { icon: Globe, category: 'Plage', text: 'Barceloneta n\'existait pas avant les JO de 1992. Les plages ont été créées pour l\'événement.' },
    { icon: Banknote, category: 'Budget', text: 'Un menu del dia (menu du jour) dans un bon restaurant local coûte 12-15 EUR.' },
    { icon: Sun, category: 'Météo', text: 'Barcelone profite de plus de 2 500 heures de soleil par an avec une température moyenne de 18 °C.' },
  ],
  rome: [
    { icon: Landmark, category: 'Histoire', text: 'Le Colisée pouvait accueillir 50 000 spectateurs et possédait un système de voiles rétractables contre le soleil.' },
    { icon: Utensils, category: 'Gastronomie', text: 'Les quatre pâtes romaines classiques : carbonara, cacio e pepe, amatriciana et gricia.' },
    { icon: Info, category: 'Le saviez-vous ?', text: 'La fontaine de Trevi collecte environ 3 000 EUR de pièces par jour, reversés à une association caritative.' },
    { icon: Languages, category: 'Culture', text: 'Le Vatican est le plus petit État du monde avec 0,44 km2 et environ 800 habitants.' },
    { icon: Globe, category: 'Transport', text: 'Le métro de Rome n\'a que 3 lignes car les fouilles archéologiques bloquent chaque nouveau chantier.' },
    { icon: Banknote, category: 'Budget', text: 'Un expresso au comptoir coûte environ 1,10 EUR partout en Italie (prix réglementé).' },
    { icon: Sun, category: 'Conseil', text: 'Réservez vos billets pour le Vatican et le Colisée en ligne pour éviter 2-3 heures de queue.' },
  ],
  london: [
    { icon: Landmark, category: 'Histoire', text: 'Big Ben est en réalité le nom de la cloche, pas de la tour. La tour s\'appelle Elizabeth Tower.' },
    { icon: Utensils, category: 'Gastronomie', text: 'Le fish and chips traditionnel se mange avec du vinaigre de malt, pas de la mayonnaise.' },
    { icon: Globe, category: 'Transport', text: 'Le métro de Londres (The Tube) est le plus ancien au monde, ouvert en 1863.' },
    { icon: Languages, category: 'Culture', text: 'Plus de 300 langues sont parlées à Londres, c\'est la ville la plus linguistiquement diverse au monde.' },
    { icon: Info, category: 'Le saviez-vous ?', text: 'Conduire dans le centre de Londres coûte 15 GBP par jour en péage urbain (congestion charge).' },
    { icon: Banknote, category: 'Budget', text: 'La plupart des grands musées de Londres sont gratuits : British Museum, Tate Modern, Natural History...' },
  ],
  'new york': [
    { icon: Landmark, category: 'Histoire', text: 'Central Park a été entièrement conçu par l\'homme. Chaque arbre, lac et rocher a été placé volontairement.' },
    { icon: Utensils, category: 'Gastronomie', text: 'La pizza New-Yorkaise se mange pliée en deux. Une part classique coûte encore 1-2 USD dans certains spots.' },
    { icon: Globe, category: 'Transport', text: 'Le métro de New York fonctionne 24h/24, 7j/7. C\'est l\'un des rares au monde à ne jamais fermer.' },
    { icon: Info, category: 'Le saviez-vous ?', text: 'Times Square doit son nom au New York Times qui y avait son siège en 1904.' },
    { icon: Languages, category: 'Culture', text: 'Plus de 800 langues sont parlées à New York, ce qui en fait la ville la plus diverse linguistiquement.' },
    { icon: Banknote, category: 'Budget', text: 'Le CityPASS permet de visiter 5 attractions majeures pour environ 130 USD au lieu de 250 USD.' },
  ],
  amsterdam: [
    { icon: Info, category: 'Le saviez-vous ?', text: 'Amsterdam compte plus de vélos (881 000) que d\'habitants (873 000).' },
    { icon: Landmark, category: 'Culture', text: 'La Maison d\'Anne Frank reçoit plus d\'un million de visiteurs par an. Réservez des semaines à l\'avance.' },
    { icon: Globe, category: 'Transport', text: 'Le Vondelpark accueille 10 millions de visiteurs par an. C\'est le Central Park d\'Amsterdam.' },
    { icon: Utensils, category: 'Gastronomie', text: 'Le stroopwafel est né à Gouda au 18e siècle. Posez-le sur votre café pour ramollir le caramel.' },
    { icon: Banknote, category: 'Budget', text: 'La carte I Amsterdam City Card donne accès à 70+ musées et aux transports pour 60 EUR/jour.' },
  ],
  lisbonne: [
    { icon: Landmark, category: 'Histoire', text: 'Le tremblement de terre de 1755 a détruit 85% de Lisbonne. La reconstruction a créé le quartier Baixa.' },
    { icon: Utensils, category: 'Gastronomie', text: 'Les pastéis de nata ont été inventés par les moines du monastère des Hiéronymites à Belém.' },
    { icon: Globe, category: 'Transport', text: 'Le tramway 28 traverse les quartiers historiques d\'Alfama à Estrela. Attention aux pickpockets.' },
    { icon: Languages, category: 'Culture', text: 'Le fado, musique traditionnelle portugaise, est inscrit au patrimoine immatériel de l\'UNESCO.' },
    { icon: Banknote, category: 'Budget', text: 'Lisbonne est l\'une des capitales les moins chères d\'Europe de l\'Ouest. Un repas complet coûte 10-15 EUR.' },
    { icon: Sun, category: 'Météo', text: 'Lisbonne est la capitale la plus ensoleillée d\'Europe avec 2 800 heures de soleil par an.' },
  ],
  marrakech: [
    { icon: Landmark, category: 'Histoire', text: 'La place Jemaa el-Fna est inscrite au patrimoine oral de l\'UNESCO pour ses conteurs et musiciens.' },
    { icon: Utensils, category: 'Gastronomie', text: 'Le tajine n\'est pas un plat mais un récipient en terre cuite. Le couvercle conique redistribue la vapeur.' },
    { icon: Info, category: 'Le saviez-vous ?', text: 'Le Jardin Majorelle a appartenu à Yves Saint Laurent et Pierre Bergé qui l\'ont restauré en 1980.' },
    { icon: Languages, category: 'Langue', text: 'Au Maroc, on parle arabe, amazigh (berbère) et français. La plupart des commerçants parlent 3-4 langues.' },
    { icon: Banknote, category: 'Budget', text: 'Dans les souks, le prix initial est souvent 3-4 fois le prix réel. Négociez toujours avec le sourire.' },
    { icon: Sun, category: 'Conseil', text: 'Évitez les mois de juillet-août où la température dépasse 40 °C. Le printemps est idéal.' },
  ],
  nice: [
    { icon: Landmark, category: 'Histoire', text: 'Nice n\'est française que depuis 1860. Avant, elle appartenait au Royaume de Sardaigne.' },
    { icon: Utensils, category: 'Gastronomie', text: 'La vraie salade niçoise ne contient ni pomme de terre cuite, ni haricots verts, ni laitue.' },
    { icon: Info, category: 'Le saviez-vous ?', text: 'La Promenade des Anglais doit son nom aux aristocrates anglais qui l\'ont financée au 19e siècle.' },
    { icon: Sun, category: 'Météo', text: 'Nice profite de 300 jours de soleil par an avec une température moyenne annuelle de 16 °C.' },
    { icon: Globe, category: 'Excursion', text: 'Monaco est à seulement 20 minutes en train depuis Nice. Le trajet longe la côte, vue spectaculaire.' },
  ],
  milan: [
    { icon: Landmark, category: 'Architecture', text: 'Le Duomo de Milan a pris 600 ans à construire (1386-1965). Sa terrasse offre une vue à 360°.' },
    { icon: Utensils, category: 'Gastronomie', text: 'Le risotto alla milanese doit sa couleur jaune au safran, l\'épice la plus chère au monde.' },
    { icon: Info, category: 'Culture', text: 'Il faut réserver La Cène de Léonard de Vinci des mois à l\'avance. Les visites durent 15 minutes.' },
    { icon: Banknote, category: 'Shopping', text: 'Le Quadrilatère de la Mode (Via Montenapoleone) est le quartier du luxe le plus cher au monde.' },
    { icon: Globe, category: 'Excursion', text: 'Le Lac de Côme est à 1 heure de train de Milan. George Clooney y a sa villa.' },
  ],
  brussels: [
    { icon: Utensils, category: 'Gastronomie', text: 'Les frites sont belges, pas françaises. La Belgique compte plus de 5 000 friteries.' },
    { icon: Landmark, category: 'Histoire', text: 'La Grand-Place de Bruxelles est considérée comme l\'une des plus belles places du monde par Victor Hugo.' },
    { icon: Info, category: 'Le saviez-vous ?', text: 'La Belgique produit 220 000 tonnes de chocolat par an. Bruxelles en est la capitale mondiale.' },
    { icon: Languages, category: 'Langue', text: 'Bruxelles est officiellement bilingue français-néerlandais, mais le français domine au quotidien.' },
    { icon: Banknote, category: 'Budget', text: 'Une gaufre de Liège dans les bonnes adresses coûte 3-4 EUR. Évitez les stands touristiques.' },
  ],
  dubrovnik: [
    { icon: Landmark, category: 'Culture', text: 'Les remparts de Dubrovnik font 2 km de long et offrent une vue imprenable sur l\'Adriatique.' },
    { icon: Info, category: 'Le saviez-vous ?', text: 'Dubrovnik a servi de décor à Port-Réal (King\'s Landing) dans Game of Thrones.' },
    { icon: Globe, category: 'Excursion', text: 'L\'île de Lokrum est accessible en 15 minutes de ferry. Baignade, paons sauvages et monastère.' },
    { icon: Sun, category: 'Conseil', text: 'Visitez tôt le matin ou en fin de journée. Les bateaux de croisière déversent des milliers de touristes en journée.' },
    { icon: Banknote, category: 'Budget', text: 'La Croatie utilise l\'euro depuis 2023. Les prix à Dubrovnik sont parmi les plus élevés du pays.' },
  ],
  bali: [
    { icon: Landmark, category: 'Culture', text: 'Bali compte plus de 20 000 temples, lui valant le surnom d\'« île des dieux ». Chaque village en possède au moins trois.' },
    { icon: Info, category: 'Le saviez-vous ?', text: 'Plus de 80 % des Balinais pratiquent l\'hindouisme balinais, un mélange unique de croyances hindoues et animistes.' },
    { icon: Globe, category: 'Nature', text: 'Le mont Agung, volcan actif culminant à 3 031 m, est considéré comme la demeure des dieux par les Balinais.' },
    { icon: Languages, category: 'Langue', text: 'Le balinais (Basa Bali) est une langue distincte de l\'indonésien, avec ses propres niveaux de politesse.' },
    { icon: Utensils, category: 'Gastronomie', text: 'Le babi guling (cochon de lait rôti) est le plat cérémoniel balinais par excellence, cuit avec des épices locales.' },
    { icon: Sun, category: 'Conseil', text: 'La saison sèche (avril-octobre) est idéale. Évitez les semaines autour du Nouvel An et de Noël, très touristiques.' },
    { icon: Banknote, category: 'Budget', text: 'Un repas dans un warung (restaurant local) coûte entre 25 000 et 50 000 IDR (1,50-3 EUR).' },
  ],
  bangkok: [
    { icon: Landmark, category: 'Culture', text: 'Le Grand Palais de Bangkok abrite le Bouddha d\'Émeraude, dont les vêtements sont changés trois fois par an par le roi.' },
    { icon: Utensils, category: 'Gastronomie', text: 'La street food de Bangkok est légendaire : un pad thai ou un mango sticky rice coûte 40-60 bahts (1-2 EUR).' },
    { icon: Info, category: 'Le saviez-vous ?', text: 'Le nom officiel complet de Bangkok compte 168 lettres en thaï, ce qui en fait le nom de ville le plus long au monde.' },
    { icon: Globe, category: 'Transport', text: 'Le Chao Phraya Express Boat est l\'un des meilleurs moyens de découvrir la ville : rapide, pas cher et panoramique.' },
    { icon: Landmark, category: 'Histoire', text: 'Le Wat Pho abrite un Bouddha couché de 46 mètres de long, recouvert de feuilles d\'or.' },
    { icon: Banknote, category: 'Budget', text: 'Bangkok est l\'une des grandes villes les moins chères d\'Asie : un budget de 35-50 USD/jour est réaliste.' },
    { icon: Sun, category: 'Météo', text: 'Évitez la mousson (juin-octobre). La meilleure période est novembre-février avec des températures autour de 25-30 °C.' },
  ],
  istanbul: [
    { icon: Globe, category: 'Géographie', text: 'Istanbul est la seule métropole au monde à cheval sur deux continents : l\'Europe et l\'Asie, séparées par le Bosphore.' },
    { icon: Landmark, category: 'Histoire', text: 'Sainte-Sophie, construite en 537, a été cathédrale, mosquée, musée, puis mosquée à nouveau en 2020. Son dôme a été le plus grand du monde pendant 1 000 ans.' },
    { icon: Utensils, category: 'Gastronomie', text: 'Le petit-déjeuner turc traditionnel est un festin : fromages, olives, miel, tomates, concombres, œufs et thé noir.' },
    { icon: Info, category: 'Le saviez-vous ?', text: 'Le Grand Bazar d\'Istanbul est l\'un des plus grands marchés couverts au monde avec plus de 4 000 boutiques.' },
    { icon: Languages, category: 'Culture', text: 'Istanbul a été capitale de trois empires successifs : romain, byzantin et ottoman, sur plus de 1 600 ans.' },
    { icon: Banknote, category: 'Budget', text: 'Un simit (pain au sésame) coûte 5-10 TRY dans la rue. Le kebab est un repas complet pour 80-120 TRY (3-4 EUR).' },
  ],
  prague: [
    { icon: Landmark, category: 'Histoire', text: 'Le pont Charles, construit en 1357, mesure 516 m. La première pierre a été posée le 9 juillet à 5h31, un moment choisi par les astrologues royaux.' },
    { icon: Utensils, category: 'Gastronomie', text: 'La République tchèque a la plus forte consommation de bière par habitant au monde : environ 140 litres par an.' },
    { icon: Info, category: 'Le saviez-vous ?', text: 'L\'horloge astronomique de Prague, installée en 1410, est la troisième plus ancienne au monde et la plus ancienne encore en fonctionnement.' },
    { icon: Languages, category: 'Culture', text: 'Prague est surnommée « la ville aux cent clochers ». En réalité, elle en compte bien plus de 500.' },
    { icon: Globe, category: 'Architecture', text: 'Le château de Prague est le plus grand château ancien du monde selon le Guinness Book : 70 000 m2.' },
    { icon: Banknote, category: 'Budget', text: 'Une pinte de bière locale dans un pub coûte 40-60 CZK (1,70-2,50 EUR). Prague reste abordable pour l\'Europe de l\'Ouest.' },
  ],
  vienne: [
    { icon: Landmark, category: 'Culture', text: 'Vienne accueille plus de 450 bals chaque année entre le Nouvel An et le Carême, dont le célèbre Bal de l\'Opéra.' },
    { icon: Utensils, category: 'Gastronomie', text: 'La culture des cafés viennois est inscrite au patrimoine immatériel de l\'UNESCO. Le Melange est l\'équivalent local du cappuccino.' },
    { icon: Info, category: 'Le saviez-vous ?', text: 'Le zoo de Schönbrunn, fondé en 1752, est le plus ancien zoo du monde encore en activité.' },
    { icon: Languages, category: 'Musique', text: 'Mozart, Beethoven, Schubert, Strauss et Haydn ont tous vécu et composé à Vienne, capitale mondiale de la musique classique.' },
    { icon: Globe, category: 'Transport', text: 'Le Ringstrasse, boulevard circulaire de 5,3 km, concentre les plus beaux édifices de Vienne : Opéra, Parlement, Hofburg.' },
    { icon: Banknote, category: 'Budget', text: 'Le Wiener Schnitzel (escalope viennoise) dans un bon Beisl coûte 12-16 EUR. La Sachertorte au Café Sacher : 7 EUR.' },
  ],
  vienna: [
    { icon: Landmark, category: 'Culture', text: 'Vienne accueille plus de 450 bals chaque année entre le Nouvel An et le Carême, dont le célèbre Bal de l\'Opéra.' },
    { icon: Utensils, category: 'Gastronomie', text: 'La culture des cafés viennois est inscrite au patrimoine immatériel de l\'UNESCO. Le Melange est l\'équivalent local du cappuccino.' },
    { icon: Info, category: 'Le saviez-vous ?', text: 'Le zoo de Schönbrunn, fondé en 1752, est le plus ancien zoo du monde encore en activité.' },
    { icon: Languages, category: 'Musique', text: 'Mozart, Beethoven, Schubert, Strauss et Haydn ont tous vécu et composé à Vienne, capitale mondiale de la musique classique.' },
    { icon: Globe, category: 'Transport', text: 'Le Ringstrasse, boulevard circulaire de 5,3 km, concentre les plus beaux édifices de Vienne : Opéra, Parlement, Hofburg.' },
    { icon: Banknote, category: 'Budget', text: 'Le Wiener Schnitzel (escalope viennoise) dans un bon Beisl coûte 12-16 EUR. La Sachertorte au Café Sacher : 7 EUR.' },
  ],
  berlin: [
    { icon: Landmark, category: 'Histoire', text: 'Le Mur de Berlin a divisé la ville pendant 28 ans (1961-1989). L\'East Side Gallery est la plus longue galerie d\'art en plein air du monde : 1,3 km.' },
    { icon: Info, category: 'Le saviez-vous ?', text: 'L\'île aux Musées (Museumsinsel) regroupe 5 musées majeurs sur une île de la Spree. C\'est un site UNESCO.' },
    { icon: Utensils, category: 'Gastronomie', text: 'Le currywurst (saucisse au curry) est le snack berlinois par excellence. La ville en consomme 70 millions par an.' },
    { icon: Globe, category: 'Culture', text: 'Berlin compte plus de 180 musées, 3 opéras et plus de clubs que toute autre ville européenne.' },
    { icon: Languages, category: 'Diversité', text: 'Berlin est l\'une des villes les plus multiculturelles d\'Europe : 190 nationalités y cohabitent.' },
    { icon: Banknote, category: 'Budget', text: 'Berlin reste l\'une des capitales les moins chères d\'Europe de l\'Ouest. Un döner kebab coûte 5-7 EUR.' },
  ],
  dubai: [
    { icon: Landmark, category: 'Architecture', text: 'Le Burj Khalifa culmine à 828 m avec 163 étages. Sa construction a mobilisé 12 000 ouvriers pendant 6 ans.' },
    { icon: Info, category: 'Le saviez-vous ?', text: 'Dubaï était un simple village de pêcheurs dans les années 1960. La découverte du pétrole a transformé la ville en métropole futuriste.' },
    { icon: Utensils, category: 'Gastronomie', text: 'Le shawarma, le falafel et le biryani de rue sont excellents et coûtent 10-20 AED (2-5 EUR).' },
    { icon: Globe, category: 'Culture', text: 'Le quartier historique Al Fahidi montre le Dubaï d\'avant le pétrole, avec ses maisons en corail et ses tours à vent.' },
    { icon: Sun, category: 'Météo', text: 'Évitez l\'été (juin-août) où les températures dépassent 45 °C. L\'hiver (nov-mars) est idéal avec 20-25 °C.' },
    { icon: Banknote, category: 'Budget', text: 'Le spectacle des fontaines du Burj Khalifa est gratuit toutes les 30 minutes à partir de 18h.' },
  ],
  'dubaï': [
    { icon: Landmark, category: 'Architecture', text: 'Le Burj Khalifa culmine à 828 m avec 163 étages. Sa construction a mobilisé 12 000 ouvriers pendant 6 ans.' },
    { icon: Info, category: 'Le saviez-vous ?', text: 'Dubaï était un simple village de pêcheurs dans les années 1960. La découverte du pétrole a transformé la ville en métropole futuriste.' },
    { icon: Utensils, category: 'Gastronomie', text: 'Le shawarma, le falafel et le biryani de rue sont excellents et coûtent 10-20 AED (2-5 EUR).' },
    { icon: Globe, category: 'Culture', text: 'Le quartier historique Al Fahidi montre le Dubaï d\'avant le pétrole, avec ses maisons en corail et ses tours à vent.' },
    { icon: Sun, category: 'Météo', text: 'Évitez l\'été (juin-août) où les températures dépassent 45 °C. L\'hiver (nov-mars) est idéal avec 20-25 °C.' },
    { icon: Banknote, category: 'Budget', text: 'Le spectacle des fontaines du Burj Khalifa est gratuit toutes les 30 minutes à partir de 18h.' },
  ],
  seoul: [
    { icon: Landmark, category: 'Histoire', text: 'Le palais Gyeongbokgung, construit en 1395, est le plus grand des cinq palais royaux de Séoul. La relève de la garde est spectaculaire.' },
    { icon: Utensils, category: 'Gastronomie', text: 'Le bibimbap (riz mélangé aux légumes) et le barbecue coréen sont incontournables. Gwangjang Market est le paradis du street food.' },
    { icon: Info, category: 'Le saviez-vous ?', text: 'La fontaine arc-en-ciel du pont Banpo est la plus longue fontaine de pont au monde : 1 140 m avec jeux de lumières LED.' },
    { icon: Languages, category: 'Culture', text: 'Séoul est le berceau de la K-pop. Les sièges de HYBE, SM, YG et JYP Entertainment sont tous dans la ville.' },
    { icon: Globe, category: 'Contrastes', text: 'Le village Bukchon Hanok, avec ses maisons traditionnelles, est niché entre des gratte-ciels ultramodernes.' },
    { icon: Banknote, category: 'Budget', text: 'Un repas dans un restaurant local coûte 7 000-12 000 KRW (5-8 EUR). Le métro est moderne et très abordable.' },
  ],
  'séoul': [
    { icon: Landmark, category: 'Histoire', text: 'Le palais Gyeongbokgung, construit en 1395, est le plus grand des cinq palais royaux de Séoul. La relève de la garde est spectaculaire.' },
    { icon: Utensils, category: 'Gastronomie', text: 'Le bibimbap (riz mélangé aux légumes) et le barbecue coréen sont incontournables. Gwangjang Market est le paradis du street food.' },
    { icon: Info, category: 'Le saviez-vous ?', text: 'La fontaine arc-en-ciel du pont Banpo est la plus longue fontaine de pont au monde : 1 140 m avec jeux de lumières LED.' },
    { icon: Languages, category: 'Culture', text: 'Séoul est le berceau de la K-pop. Les sièges de HYBE, SM, YG et JYP Entertainment sont tous dans la ville.' },
    { icon: Globe, category: 'Contrastes', text: 'Le village Bukchon Hanok, avec ses maisons traditionnelles, est niché entre des gratte-ciels ultramodernes.' },
    { icon: Banknote, category: 'Budget', text: 'Un repas dans un restaurant local coûte 7 000-12 000 KRW (5-8 EUR). Le métro est moderne et très abordable.' },
  ],
  singapour: [
    { icon: Utensils, category: 'Gastronomie', text: 'La culture hawker de Singapour est inscrite au patrimoine de l\'UNESCO. Certains stands ont même obtenu des étoiles Michelin.' },
    { icon: Landmark, category: 'Architecture', text: 'La piscine à débordement du Marina Bay Sands, à 200 m de hauteur, est la plus haute du monde.' },
    { icon: Info, category: 'Le saviez-vous ?', text: 'Singapour est l\'un des pays les plus propres au monde grâce à 50 000 agents de nettoyage et des amendes sévères.' },
    { icon: Globe, category: 'Nature', text: 'Les Gardens by the Bay abritent des « supertrees » de 25-50 m avec un spectacle son et lumière gratuit chaque soir.' },
    { icon: Languages, category: 'Langue', text: 'Singapour a 4 langues officielles : anglais, mandarin, malais et tamoul. Le « Singlish » mélange les quatre.' },
    { icon: Banknote, category: 'Budget', text: 'Un repas dans un hawker centre coûte 3-5 SGD (2-4 EUR). C\'est la meilleure street food du monde à prix mini.' },
  ],
  singapore: [
    { icon: Utensils, category: 'Gastronomie', text: 'La culture hawker de Singapour est inscrite au patrimoine de l\'UNESCO. Certains stands ont même obtenu des étoiles Michelin.' },
    { icon: Landmark, category: 'Architecture', text: 'La piscine à débordement du Marina Bay Sands, à 200 m de hauteur, est la plus haute du monde.' },
    { icon: Info, category: 'Le saviez-vous ?', text: 'Singapour est l\'un des pays les plus propres au monde grâce à 50 000 agents de nettoyage et des amendes sévères.' },
    { icon: Globe, category: 'Nature', text: 'Les Gardens by the Bay abritent des « supertrees » de 25-50 m avec un spectacle son et lumière gratuit chaque soir.' },
    { icon: Languages, category: 'Langue', text: 'Singapour a 4 langues officielles : anglais, mandarin, malais et tamoul. Le « Singlish » mélange les quatre.' },
    { icon: Banknote, category: 'Budget', text: 'Un repas dans un hawker centre coûte 3-5 SGD (2-4 EUR). C\'est la meilleure street food du monde à prix mini.' },
  ],
  sydney: [
    { icon: Landmark, category: 'Architecture', text: 'L\'Opéra de Sydney a pris 14 ans à construire (1959-1973). Son toit est couvert de plus d\'un million de tuiles suédoises.' },
    { icon: Info, category: 'Le saviez-vous ?', text: 'Malgré son nom, l\'Opéra de Sydney accueille plus de 2 000 spectacles par an dont seulement 15 % d\'opéra.' },
    { icon: Globe, category: 'Nature', text: 'Bondi Beach est l\'une des plages les plus célèbres au monde. La balade côtière jusqu\'à Coogee fait 6 km.' },
    { icon: Utensils, category: 'Gastronomie', text: 'Le flat white (café) est une invention australo-néo-zélandaise. Sydney possède une culture café exceptionnelle.' },
    { icon: Sun, category: 'Météo', text: 'Sydney bénéficie de 340 jours de soleil par an. L\'été (déc-fév) est idéal mais l\'automne (mars-mai) est plus doux.' },
    { icon: Banknote, category: 'Budget', text: 'Les ferries du port de Sydney offrent des vues spectaculaires sur l\'Opéra et le Harbour Bridge pour quelques dollars.' },
  ],
  kyoto: [
    { icon: Landmark, category: 'Histoire', text: 'Kyoto a été la capitale impériale du Japon pendant plus de 1 000 ans (794-1868). Son nom signifie « capitale ».' },
    { icon: Info, category: 'Le saviez-vous ?', text: 'Kyoto a été épargnée des bombardements de la Seconde Guerre mondiale, préservant son patrimoine unique de plus de 1 600 temples.' },
    { icon: Languages, category: 'Culture', text: 'Les geiko (geisha de Kyoto) et leurs apprenties maiko perpétuent les arts traditionnels dans le quartier de Gion.' },
    { icon: Globe, category: 'Nature', text: 'La forêt de bambous d\'Arashiyama est l\'un des sites les plus photographiés du Japon. Visitez tôt le matin pour l\'éviter la foule.' },
    { icon: Utensils, category: 'Gastronomie', text: 'La cuisine kaiseki de Kyoto est un art culinaire raffiné. La ville est aussi célèbre pour son matcha et ses wagashi (pâtisseries).' },
    { icon: Banknote, category: 'Budget', text: 'Le pass bus journalier (700 JPY) couvre la plupart des temples. Beaucoup de sanctuaires shinto sont gratuits.' },
    { icon: Info, category: 'Le saviez-vous ?', text: 'Nintendo a été fondé à Kyoto en 1889 comme fabricant de cartes à jouer hanafuda, pas de jeux vidéo.' },
  ],
  santorin: [
    { icon: Landmark, category: 'Histoire', text: 'Santorin doit sa forme de croissant à une éruption volcanique vers 1600 av. J.-C. Certains y voient l\'origine du mythe de l\'Atlantide.' },
    { icon: Sun, category: 'Coucher de soleil', text: 'Le coucher de soleil depuis Oia est considéré comme l\'un des plus beaux au monde grâce à la géographie volcanique de l\'île.' },
    { icon: Utensils, category: 'Gastronomie', text: 'Le Vinsanto est un vin doux local vieilli au soleil. Le cépage Assyrtiko produit des blancs minéraux uniques au monde.' },
    { icon: Info, category: 'Le saviez-vous ?', text: 'Avant l\'éruption, l\'île s\'appelait Stroggili (« la ronde » en grec). Elle était circulaire et beaucoup plus grande.' },
    { icon: Globe, category: 'Plage', text: 'Les plages de Santorin sont uniques : sable noir à Perissa, sable rouge à Red Beach, dû à l\'activité volcanique.' },
    { icon: Banknote, category: 'Budget', text: 'Visitez en mai-juin ou septembre-octobre : moins de monde, prix plus bas, et températures idéales (22-26 °C).' },
  ],
  santorini: [
    { icon: Landmark, category: 'Histoire', text: 'Santorin doit sa forme de croissant à une éruption volcanique vers 1600 av. J.-C. Certains y voient l\'origine du mythe de l\'Atlantide.' },
    { icon: Sun, category: 'Coucher de soleil', text: 'Le coucher de soleil depuis Oia est considéré comme l\'un des plus beaux au monde grâce à la géographie volcanique de l\'île.' },
    { icon: Utensils, category: 'Gastronomie', text: 'Le Vinsanto est un vin doux local vieilli au soleil. Le cépage Assyrtiko produit des blancs minéraux uniques au monde.' },
    { icon: Info, category: 'Le saviez-vous ?', text: 'Avant l\'éruption, l\'île s\'appelait Stroggili (« la ronde » en grec). Elle était circulaire et beaucoup plus grande.' },
    { icon: Globe, category: 'Plage', text: 'Les plages de Santorin sont uniques : sable noir à Perissa, sable rouge à Red Beach, dû à l\'activité volcanique.' },
    { icon: Banknote, category: 'Budget', text: 'Visitez en mai-juin ou septembre-octobre : moins de monde, prix plus bas, et températures idéales (22-26 °C).' },
  ],
  budapest: [
    { icon: Landmark, category: 'Histoire', text: 'Budapest possède plus de 100 sources thermales naturelles, plus que toute autre capitale au monde. Les Romains les utilisaient déjà.' },
    { icon: Utensils, category: 'Gastronomie', text: 'Le goulash hongrois est en réalité une soupe, pas un ragoût. Le vrai plat consistant s\'appelle « pörkölt ».' },
    { icon: Info, category: 'Le saviez-vous ?', text: 'Les « ruin bars » de Budapest sont des bars installés dans des bâtiments abandonnés du quartier juif, décorés de bric-à-brac artistique.' },
    { icon: Globe, category: 'Architecture', text: 'Le Parlement hongrois est le troisième plus grand au monde, avec 691 pièces et 20 km de couloirs.' },
    { icon: Sun, category: 'Détente', text: 'Les bains Széchenyi, construits en 1913 en style néo-baroque, sont les plus grands bains thermaux médicinaux d\'Europe.' },
    { icon: Banknote, category: 'Budget', text: 'Budapest est très abordable : un repas complet dans un bon restaurant coûte 3 000-5 000 HUF (8-14 EUR).' },
  ],
  copenhague: [
    { icon: Globe, category: 'Vélo', text: 'Copenhague compte 675 000 vélos pour 120 000 voitures. La moitié des habitants vont au travail à vélo chaque jour.' },
    { icon: Landmark, category: 'Histoire', text: 'Les jardins de Tivoli, ouverts en 1843, ont inspiré Walt Disney pour créer Disneyland. C\'est l\'un des plus anciens parcs d\'attractions au monde.' },
    { icon: Utensils, category: 'Gastronomie', text: 'Copenhague détient plus d\'étoiles Michelin que toute autre ville scandinave. Le Noma a été élu meilleur restaurant du monde.' },
    { icon: Languages, category: 'Culture', text: 'Le concept danois de « hygge » (bien-être, convivialité) est au cœur de la culture locale et se vit dans les cafés.' },
    { icon: Info, category: 'Le saviez-vous ?', text: 'La Petite Sirène, statue emblématique du port, ne mesure que 1,25 m de haut. Elle déçoit souvent les touristes par sa taille.' },
    { icon: Banknote, category: 'Budget', text: 'Copenhague est chère, mais la Copenhagen Card (80 EUR/jour) inclut 80+ attractions et les transports en commun.' },
  ],
  copenhagen: [
    { icon: Globe, category: 'Vélo', text: 'Copenhague compte 675 000 vélos pour 120 000 voitures. La moitié des habitants vont au travail à vélo chaque jour.' },
    { icon: Landmark, category: 'Histoire', text: 'Les jardins de Tivoli, ouverts en 1843, ont inspiré Walt Disney pour créer Disneyland. C\'est l\'un des plus anciens parcs d\'attractions au monde.' },
    { icon: Utensils, category: 'Gastronomie', text: 'Copenhague détient plus d\'étoiles Michelin que toute autre ville scandinave. Le Noma a été élu meilleur restaurant du monde.' },
    { icon: Languages, category: 'Culture', text: 'Le concept danois de « hygge » (bien-être, convivialité) est au cœur de la culture locale et se vit dans les cafés.' },
    { icon: Info, category: 'Le saviez-vous ?', text: 'La Petite Sirène, statue emblématique du port, ne mesure que 1,25 m de haut. Elle déçoit souvent les touristes par sa taille.' },
    { icon: Banknote, category: 'Budget', text: 'Copenhague est chère, mais la Copenhagen Card (80 EUR/jour) inclut 80+ attractions et les transports en commun.' },
  ],
  'athènes': [
    { icon: Landmark, category: 'Histoire', text: 'Athènes est l\'une des plus anciennes villes du monde avec plus de 3 400 ans d\'histoire. Berceau de la démocratie et du théâtre.' },
    { icon: Info, category: 'Le saviez-vous ?', text: 'Le Parthénon abritait autrefois une statue d\'Athéna en or et ivoire de 12 mètres de haut, œuvre du sculpteur Phidias.' },
    { icon: Utensils, category: 'Gastronomie', text: 'La cuisine grecque est un art de vivre : moussaka, souvlaki, tzatziki et baklava. Les tavernes du quartier Plaka sont incontournables.' },
    { icon: Globe, category: 'Culture', text: 'Athènes compte près de 150 théâtres, un record par habitant. Le théâtre de Dionysos, au pied de l\'Acropole, date du 5e siècle av. J.-C.' },
    { icon: Sun, category: 'Météo', text: 'Athènes bénéficie de plus de 250 jours de soleil par an. Évitez juillet-août (40 °C+), préférez le printemps ou l\'automne.' },
    { icon: Banknote, category: 'Budget', text: 'Un souvlaki complet (gyros pita) coûte 3-4 EUR. Le billet combiné pour les sites archéologiques dure 5 jours pour 30 EUR.' },
  ],
  athens: [
    { icon: Landmark, category: 'Histoire', text: 'Athènes est l\'une des plus anciennes villes du monde avec plus de 3 400 ans d\'histoire. Berceau de la démocratie et du théâtre.' },
    { icon: Info, category: 'Le saviez-vous ?', text: 'Le Parthénon abritait autrefois une statue d\'Athéna en or et ivoire de 12 mètres de haut, œuvre du sculpteur Phidias.' },
    { icon: Utensils, category: 'Gastronomie', text: 'La cuisine grecque est un art de vivre : moussaka, souvlaki, tzatziki et baklava. Les tavernes du quartier Plaka sont incontournables.' },
    { icon: Globe, category: 'Culture', text: 'Athènes compte près de 150 théâtres, un record par habitant. Le théâtre de Dionysos, au pied de l\'Acropole, date du 5e siècle av. J.-C.' },
    { icon: Sun, category: 'Météo', text: 'Athènes bénéficie de plus de 250 jours de soleil par an. Évitez juillet-août (40 °C+), préférez le printemps ou l\'automne.' },
    { icon: Banknote, category: 'Budget', text: 'Un souvlaki complet (gyros pita) coûte 3-4 EUR. Le billet combiné pour les sites archéologiques dure 5 jours pour 30 EUR.' },
  ],
  mexico: [
    { icon: Landmark, category: 'Histoire', text: 'Mexico est construite sur un lac asséché. La ville s\'enfonce de 10-12 cm par an, ce qui fait pencher certains bâtiments.' },
    { icon: Utensils, category: 'Gastronomie', text: 'Les tacos al pastor sont inspirés du shawarma libanais, adapté avec du porc et des épices mexicaines. La cuisine mexicaine est au patrimoine de l\'UNESCO.' },
    { icon: Info, category: 'Le saviez-vous ?', text: 'Les pyramides de Teotihuacán, à 50 km de Mexico, abritaient une cité de 100 000 habitants vers l\'an 400.' },
    { icon: Globe, category: 'Géographie', text: 'Avec plus de 21 millions d\'habitants, Mexico est la plus grande ville hispanophone du monde.' },
    { icon: Languages, category: 'Culture', text: 'Le Día de los Muertos (Jour des Morts) est une fête colorée où les familles honorent leurs défunts avec des autels fleuris.' },
    { icon: Banknote, category: 'Budget', text: 'Un taco de rue coûte 15-25 MXN (0,80-1,30 EUR). Mexico est l\'une des mégalopoles les plus abordables au monde.' },
  ],
  'buenos aires': [
    { icon: Languages, category: 'Culture', text: 'Le tango est né dans les quartiers populaires de Buenos Aires au 19e siècle. Il est inscrit au patrimoine de l\'UNESCO.' },
    { icon: Utensils, category: 'Gastronomie', text: 'L\'Argentine est le pays de la viande : un asado (barbecue) dans une bonne parrilla est un rituel social incontournable.' },
    { icon: Landmark, category: 'Architecture', text: 'Le quartier La Boca, avec ses maisons colorées en tôle ondulée, est le berceau du tango et du club Boca Juniors.' },
    { icon: Info, category: 'Le saviez-vous ?', text: 'Buenos Aires possède la plus large avenue du monde : l\'Avenida 9 de Julio, avec 16 voies de circulation.' },
    { icon: Globe, category: 'Sortie', text: 'Les Porteños (habitants de BA) dînent rarement avant 22h et sortent en boîte vers 2h du matin. Le rythme de vie est très tardif.' },
    { icon: Banknote, category: 'Budget', text: 'Un spectacle de tango authentique dans une milonga locale coûte environ 10 USD, bien moins que les shows touristiques.' },
  ],
  'le caire': [
    { icon: Landmark, category: 'Histoire', text: 'La pyramide de Khéops est la seule des Sept Merveilles du monde antique encore debout. Elle pèse l\'équivalent de 16 Empire State Buildings.' },
    { icon: Info, category: 'Le saviez-vous ?', text: 'Les pyramides n\'ont pas été construites par des esclaves mais par des ouvriers qualifiés, nourris et soignés.' },
    { icon: Utensils, category: 'Gastronomie', text: 'Le koshary est le plat national égyptien : riz, lentilles, pâtes et oignons frits avec sauce tomate épicée. Un repas complet pour moins d\'1 EUR.' },
    { icon: Globe, category: 'Culture', text: 'Le Caire est la plus grande ville d\'Afrique et du monde arabe avec plus de 20 millions d\'habitants dans l\'agglomération.' },
    { icon: Languages, category: 'Patrimoine', text: 'Le musée égyptien du Caire abrite plus de 120 000 objets, dont le masque d\'or de Toutânkhamon.' },
    { icon: Sun, category: 'Conseil', text: 'Visitez les pyramides dès l\'ouverture (8h) pour éviter la chaleur et les foules. Le coucher de soleil sur Gizeh est inoubliable.' },
  ],
  cairo: [
    { icon: Landmark, category: 'Histoire', text: 'La pyramide de Khéops est la seule des Sept Merveilles du monde antique encore debout. Elle pèse l\'équivalent de 16 Empire State Buildings.' },
    { icon: Info, category: 'Le saviez-vous ?', text: 'Les pyramides n\'ont pas été construites par des esclaves mais par des ouvriers qualifiés, nourris et soignés.' },
    { icon: Utensils, category: 'Gastronomie', text: 'Le koshary est le plat national égyptien : riz, lentilles, pâtes et oignons frits avec sauce tomate épicée. Un repas complet pour moins d\'1 EUR.' },
    { icon: Globe, category: 'Culture', text: 'Le Caire est la plus grande ville d\'Afrique et du monde arabe avec plus de 20 millions d\'habitants dans l\'agglomération.' },
    { icon: Languages, category: 'Patrimoine', text: 'Le musée égyptien du Caire abrite plus de 120 000 objets, dont le masque d\'or de Toutânkhamon.' },
    { icon: Sun, category: 'Conseil', text: 'Visitez les pyramides dès l\'ouverture (8h) pour éviter la chaleur et les foules. Le coucher de soleil sur Gizeh est inoubliable.' },
  ],
  'montréal': [
    { icon: Languages, category: 'Langue', text: 'Montréal est la deuxième plus grande ville francophone au monde après Paris. Plus de 59 % des habitants sont bilingues.' },
    { icon: Utensils, category: 'Gastronomie', text: 'La poutine (frites, fromage en grains, sauce brune) est née au Québec. Le bagel montréalais, cuit au feu de bois, rivalise avec celui de New York.' },
    { icon: Info, category: 'Le saviez-vous ?', text: 'La ville souterraine de Montréal s\'étend sur 32 km et relie métros, boutiques et hôtels. 500 000 personnes l\'utilisent chaque jour.' },
    { icon: Globe, category: 'Festivals', text: 'Montréal est surnommée la « ville des festivals » : Jazz Fest, Juste pour Rire, et plus de 100 festivals par an.' },
    { icon: Landmark, category: 'Architecture', text: 'La basilique Notre-Dame de Montréal est un chef-d\'œuvre néo-gothique. Son intérieur bleu et doré est époustouflant.' },
    { icon: Sun, category: 'Saison', text: 'L\'été (juin-août) est la meilleure saison avec des terrasses animées. L\'hiver descend à -20 °C mais le carnaval compense.' },
  ],
  montreal: [
    { icon: Languages, category: 'Langue', text: 'Montréal est la deuxième plus grande ville francophone au monde après Paris. Plus de 59 % des habitants sont bilingues.' },
    { icon: Utensils, category: 'Gastronomie', text: 'La poutine (frites, fromage en grains, sauce brune) est née au Québec. Le bagel montréalais, cuit au feu de bois, rivalise avec celui de New York.' },
    { icon: Info, category: 'Le saviez-vous ?', text: 'La ville souterraine de Montréal s\'étend sur 32 km et relie métros, boutiques et hôtels. 500 000 personnes l\'utilisent chaque jour.' },
    { icon: Globe, category: 'Festivals', text: 'Montréal est surnommée la « ville des festivals » : Jazz Fest, Juste pour Rire, et plus de 100 festivals par an.' },
    { icon: Landmark, category: 'Architecture', text: 'La basilique Notre-Dame de Montréal est un chef-d\'œuvre néo-gothique. Son intérieur bleu et doré est époustouflant.' },
    { icon: Sun, category: 'Saison', text: 'L\'été (juin-août) est la meilleure saison avec des terrasses animées. L\'hiver descend à -20 °C mais le carnaval compense.' },
  ],
  reykjavik: [
    { icon: Globe, category: 'Géographie', text: 'Reykjavik est la capitale la plus septentrionale du monde, juste sous le cercle arctique.' },
    { icon: Landmark, category: 'Géologie', text: 'L\'Islande est le seul endroit au monde où la dorsale médio-atlantique est visible. À Thingvellir, on marche entre deux plaques tectoniques.' },
    { icon: Sun, category: 'Aurores boréales', text: 'Les aurores boréales sont visibles de septembre à mars. Éloignez-vous de la ville pour un ciel plus dégagé.' },
    { icon: Utensils, category: 'Gastronomie', text: 'Le pain de seigle islandais est cuit pendant 24h dans la chaleur géothermique d\'un geyser. Un goût unique et légèrement sucré.' },
    { icon: Info, category: 'Le saviez-vous ?', text: 'L\'Islande tire 100 % de son électricité de sources renouvelables (géothermie + hydroélectricité). Le chauffage aussi.' },
    { icon: Banknote, category: 'Budget', text: 'L\'Islande est chère mais le Blue Lagoon à partir de 70 EUR et les sources chaudes gratuites dans la nature compensent.' },
  ],
  zanzibar: [
    { icon: Landmark, category: 'Histoire', text: 'Stone Town, cœur historique de Zanzibar, est classée UNESCO. Ses ruelles mêlent influences africaines, arabes et indiennes.' },
    { icon: Utensils, category: 'Gastronomie', text: 'Zanzibar est l\'« île aux épices » : clou de girofle, cannelle, cardamome et noix de muscade parfument la cuisine locale.' },
    { icon: Info, category: 'Le saviez-vous ?', text: 'Freddie Mercury (Queen) est né à Zanzibar en 1946. Sa maison natale est un lieu de pèlerinage pour les fans.' },
    { icon: Globe, category: 'Plage', text: 'Les plages de Zanzibar (Nungwi, Kendwa) ont une eau turquoise et du sable blanc. La marée peut reculer de plusieurs centaines de mètres.' },
    { icon: Sun, category: 'Conseil', text: 'La meilleure période est juin-octobre (saison sèche). Évitez les grandes pluies de mars-mai.' },
    { icon: Banknote, category: 'Budget', text: 'Un repas de fruits de mer frais sur la plage coûte 10 000-15 000 TZS (4-6 EUR). Le rapport qualité-prix est exceptionnel.' },
  ],
  hanoi: [
    { icon: Utensils, category: 'Gastronomie', text: 'Hanoï est le berceau du pho, la soupe de nouilles au bœuf. Chaque échoppe a sa recette secrète, transmise depuis des générations.' },
    { icon: Landmark, category: 'Culture', text: 'Le vieux quartier (36 rues) est organisé par métier : rue de la Soie, rue du Sucre, rue des Herboristes... depuis le 13e siècle.' },
    { icon: Info, category: 'Le saviez-vous ?', text: 'Le café aux œufs (cà phê trúng) a été inventé à Hanoï en 1946 quand le lait manquait. Le jaune d\'œuf battu remplace la crème.' },
    { icon: Globe, category: 'Transport', text: 'Le train de la rue (Train Street) passe à quelques centimètres des maisons deux fois par jour. Un spectacle unique au monde.' },
    { icon: Languages, category: 'Langue', text: 'Le vietnamien a 6 tons différents. Un même mot peut avoir 6 significations selon l\'intonation.' },
    { icon: Banknote, category: 'Budget', text: 'Un bol de pho dans la rue coûte 30 000-50 000 VND (1-2 EUR). Hanoï est l\'une des capitales les moins chères d\'Asie.' },
  ],
  'hanoï': [
    { icon: Utensils, category: 'Gastronomie', text: 'Hanoï est le berceau du pho, la soupe de nouilles au bœuf. Chaque échoppe a sa recette secrète, transmise depuis des générations.' },
    { icon: Landmark, category: 'Culture', text: 'Le vieux quartier (36 rues) est organisé par métier : rue de la Soie, rue du Sucre, rue des Herboristes... depuis le 13e siècle.' },
    { icon: Info, category: 'Le saviez-vous ?', text: 'Le café aux œufs (cà phê trúng) a été inventé à Hanoï en 1946 quand le lait manquait. Le jaune d\'œuf battu remplace la crème.' },
    { icon: Globe, category: 'Transport', text: 'Le train de la rue (Train Street) passe à quelques centimètres des maisons deux fois par jour. Un spectacle unique au monde.' },
    { icon: Languages, category: 'Langue', text: 'Le vietnamien a 6 tons différents. Un même mot peut avoir 6 significations selon l\'intonation.' },
    { icon: Banknote, category: 'Budget', text: 'Un bol de pho dans la rue coûte 30 000-50 000 VND (1-2 EUR). Hanoï est l\'une des capitales les moins chères d\'Asie.' },
  ],
};

// Generic travel facts used when destination is not in database
const GENERIC_FACTS: DestinationFact[] = [
  { icon: Plane, category: 'Conseil voyage', text: 'Prenez une photo de votre passeport et envoyez-la vous par email. Utile en cas de perte.' },
  { icon: Banknote, category: 'Budget', text: 'Retirez de l\'argent aux distributeurs des banques locales pour éviter les frais de change élevés.' },
  { icon: Globe, category: 'Conseil', text: 'Téléchargez les cartes hors-ligne de votre destination dans Google Maps avant de partir.' },
  { icon: Info, category: 'Le saviez-vous ?', text: 'Le meilleur jour pour réserver un vol est souvent le mardi, 6 à 8 semaines avant le départ.' },
  { icon: Utensils, category: 'Gastronomie', text: 'Mangez là où mangent les locaux. Évitez les restaurants avec des menus traduits en 6 langues.' },
  { icon: Languages, category: 'Culture', text: 'Apprenez au moins "bonjour", "merci" et "s\'il vous plaît" dans la langue locale. Ça change tout.' },
  { icon: Sun, category: 'Organisation', text: 'Votre itinéraire inclut du temps libre entre les activités pour les découvertes spontanées.' },
  { icon: Landmark, category: 'Conseil', text: 'Visitez les attractions populaires tôt le matin ou en fin de journée pour éviter la foule.' },
];

interface GeneratingScreenProps {
  destination: string;
  durationDays?: number;
  /** Real pipeline step label from SSE events — overrides the fake rotating messages */
  pipelineStep?: string;
  /** Current pipeline question (shown in place of the fact card) */
  question?: import('@/lib/types/pipelineQuestions').PipelineQuestion | null;
  /** Called when user answers a question */
  onAnswer?: (questionId: string, selectedOptionId: string) => void;
  /** Error message — when set, renders error UI instead of loading animation */
  error?: string;
  /** Called when user clicks retry */
  onRetry?: () => void;
}

export function GeneratingScreen({ destination, durationDays, pipelineStep, question, onAnswer, error, onRetry }: GeneratingScreenProps) {
  const { t } = useTranslation();
  const [factIndex, setFactIndex] = useState(0);
  const [stepIndex, setStepIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  // Pipeline step messages that rotate alongside facts
  const PIPELINE_STEPS = useMemo(() => [
    t('generating.searchActivities'),
    t('generating.analyzeRestaurants'),
    t('generating.optimizeItinerary'),
    t('generating.calculateTravel'),
    t('generating.checkSchedules'),
    t('generating.selectAddresses'),
    t('generating.buildPlanning'),
    t('generating.finalizing'),
  ], [t]);

  // Find the best matching facts for this destination
  const facts = useMemo(() => {
    const key = destination.toLowerCase().trim();
    // Try exact match first, then partial match
    const matched = DESTINATION_FACTS[key]
      || Object.entries(DESTINATION_FACTS).find(([k]) => key.includes(k) || k.includes(key))?.[1];
    return matched || GENERIC_FACTS;
  }, [destination]);

  // Rotate facts every 6 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setFactIndex((prev) => (prev + 1) % facts.length);
    }, 6000);
    return () => clearInterval(interval);
  }, [facts.length]);

  // Rotate pipeline steps every 4 seconds (only when no real SSE step is provided)
  useEffect(() => {
    if (pipelineStep) return; // Real SSE step overrides fake rotation
    const interval = setInterval(() => {
      setStepIndex((prev) => Math.min(prev + 1, PIPELINE_STEPS.length - 1));
    }, 4000);
    return () => clearInterval(interval);
  }, [pipelineStep]);

  // Track elapsed time
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const fact = facts[factIndex];
  const FactIcon = fact.icon;

  // When we receive a real pipeline step, compute progress from it
  // Pipeline steps come as "Step X/Y – description" — extract X/Y for the bar
  const pipelineProgress = useMemo(() => {
    if (!pipelineStep) return null;
    const match = pipelineStep.match(/(\d+)\s*\/\s*(\d+)/);
    if (match) {
      const current = parseInt(match[1], 10);
      const total = parseInt(match[2], 10);
      return Math.min((current / total) * 100, 95);
    }
    return null;
  }, [pipelineStep]);

  const progressPercent = pipelineProgress ?? Math.min((stepIndex / (PIPELINE_STEPS.length - 1)) * 100, 95);
  const displayedStep = pipelineStep || PIPELINE_STEPS[stepIndex];

  // ── Error state ──
  if (error) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#020617]"
        role="alert"
      >
        <PremiumBackground />
        <div className="mx-auto w-full max-w-lg px-6 relative z-10 text-center space-y-6">
          {/* Error icon */}
          <div className="mx-auto w-20 h-20 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
            <AlertTriangle className="h-9 w-9 text-red-400" />
          </div>

          {/* Title */}
          <h2 className="font-display text-2xl font-bold text-white">
            {t('generating.errorTitle')}
          </h2>

          {/* Description */}
          <p className="text-muted-foreground text-sm leading-relaxed max-w-sm mx-auto">
            {t('generating.errorDesc')}
          </p>

          {/* Error detail */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-xl px-5 py-4 text-left">
            <p className="text-xs text-muted-foreground font-mono break-words">{error}</p>
          </div>

          {/* Retry button */}
          {onRetry && (
            <Button
              onClick={onRetry}
              className="h-14 px-8 rounded-2xl bg-gold hover:bg-gold/90 text-black font-bold text-base gap-2"
            >
              <RotateCcw className="h-4 w-4" />
              {t('generating.retry')}
            </Button>
          )}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-[100] flex flex-col items-center pt-[8vh] bg-[#020617]"
      role="status"
      aria-live="polite"
    >
      <PremiumBackground />
      
      <div className="mx-auto w-full max-w-lg px-6 relative z-10">
        {/* Header */}
        <div className="mb-8 text-center">
          <motion.div
            animate={{ 
              y: [0, -10, 0],
              rotate: [0, 5, -5, 0]
            }}
            transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
            className="mx-auto mb-6 inline-flex h-20 w-20 items-center justify-center rounded-[2rem] bg-gradient-to-br from-[#E2B35C] via-[#C5A059] to-[#8B6E37] text-black shadow-[0_20px_40px_rgba(197,160,89,0.3)] border border-white/20"
          >
            <Plane className="h-10 w-10 stroke-[2.5px]" />
          </motion.div>
          <h2 className="font-display text-4xl font-black text-white tracking-tight mb-2">
            Conception Narae
          </h2>
          <div className="flex items-center justify-center gap-2">
            <Compass className="h-4 w-4 text-gold animate-pulse" />
            <p className="text-gold font-bold uppercase tracking-[0.2em] text-[10px]">
              {destination}{durationDays ? ` \u00b7 ${durationDays} ${t('common.days')}` : ''}
            </p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mb-4">
          <div className="h-1.5 overflow-hidden rounded-full bg-white/5 border border-white/5">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-[#E2B35C] via-[#C5A059] to-[#8B6E37] shadow-[0_0_15px_rgba(197,160,89,0.5)]"
              initial={{ width: '0%' }}
              animate={{ width: `${progressPercent}%` }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
            />
          </div>
        </div>

        {/* Pipeline step */}
        <div className="mb-12 flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-white/60" aria-live="polite" aria-atomic="true">
          <span className="flex items-center gap-2">
            <div className="h-1 w-1 rounded-full bg-gold animate-ping" />
            {displayedStep}
          </span>
          <span className="tabular-nums bg-white/5 px-2 py-1 rounded-md border border-white/5">{elapsed}s</span>
        </div>

        {/* Question or Fun fact card */}
        <div className="relative overflow-hidden rounded-[2.5rem] border border-white/10 bg-black/40 backdrop-blur-3xl p-8 shadow-2xl">
          <AnimatePresence mode="wait">
            {question && onAnswer ? (
              <QuestionCard
                key={`q-${question.questionId}`}
                question={question}
                onAnswer={onAnswer}
              />
            ) : (
              <motion.div
                key={factIndex}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.05 }}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              >
                <div className="mb-4 flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-gold/10 flex items-center justify-center text-gold">
                    <FactIcon className="h-5 w-5" />
                  </div>
                  <span className="text-xs font-black uppercase tracking-[0.2em] text-gold">
                    {fact.category}
                  </span>
                </div>
                <p className="text-lg leading-relaxed text-white font-medium">
                  {fact.text}
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Dot indicators (hidden during question) */}
          {!question && (
            <div className="mt-8 flex justify-center gap-2">
              {facts.map((_, i) => (
                <span
                  key={i}
                  className={`h-1 rounded-full transition-all duration-500 ${
                    i === factIndex
                      ? 'w-6 bg-gold shadow-[0_0_10px_rgba(197,160,89,0.5)]'
                      : 'w-1.5 bg-white/10'
                  }`}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
