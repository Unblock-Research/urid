import { View, Text, StyleSheet, ScrollView } from "react-native";

const C = { paper: "#FBF9F2", ink: "#0E0E10", ink3: "#5B5A60", ink4: "#8A8990", accent: "#7CB342", rule: "rgba(14,14,16,0.08)" };

const pillars = [
  { label: "Knowledge creation", score: 83, sub: "34 papers · 2.8K cites" },
  { label: "Peer & societal impact", score: 72, sub: "Media + policy" },
  { label: "Peer review", score: 78, sub: "142 reviews" },
  { label: "Leadership / collab", score: 69, sub: "4 mentees · 3 labs" },
  { label: "Recognition & funding", score: 81, sub: "Sloan · $1.2M" },
  { label: "Adaptability & ethics", score: 74, sub: "0 misconduct" },
  { label: "Reproducibility", score: 82, sub: "18 replicated" },
];

export default function ImpactScreen() {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.paper }} contentContainerStyle={{ padding: 16 }}>
      <View style={{ backgroundColor: "#fff", borderWidth: 1, borderColor: C.rule, borderRadius: 12, padding: 20, alignItems: "center" }}>
        <Text style={{ fontSize: 9, fontFamily: "Courier", letterSpacing: 1.5, color: C.ink4, fontWeight: "600" }}>TRUE IMPACT SCORE · V3</Text>
        <Text style={{ fontSize: 64, fontWeight: "800", color: C.ink, marginTop: 8 }}>84.2</Text>
        <Text style={{ fontSize: 11, color: C.accent, fontFamily: "Courier", marginTop: 4 }}>+2.1 · 30d</Text>
      </View>

      <Text style={{ fontSize: 9, fontFamily: "Courier", letterSpacing: 1.5, color: C.ink4, fontWeight: "600", marginTop: 20, marginBottom: 10 }}>7 PILLARS</Text>

      {pillars.map(p => (
        <View key={p.label} style={{ backgroundColor: "#fff", borderWidth: 1, borderColor: C.rule, borderRadius: 8, padding: 12, marginBottom: 8 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
            <Text style={{ fontSize: 12, color: C.ink, fontWeight: "500" }}>{p.label}</Text>
            <Text style={{ fontSize: 14, fontWeight: "700", color: C.ink, fontFamily: "Courier" }}>{p.score}</Text>
          </View>
          <View style={{ height: 4, backgroundColor: C.rule, borderRadius: 0 }}>
            <View style={{ width: `${p.score}%`, height: 4, backgroundColor: C.ink }} />
          </View>
          <Text style={{ fontSize: 10, color: C.ink4, marginTop: 4, fontFamily: "Courier" }}>{p.sub}</Text>
        </View>
      ))}
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}
