import { View, Text, ScrollView, TouchableOpacity, Alert } from "react-native";

const C = { paper: "#FBF9F2", ink: "#0E0E10", ink3: "#5B5A60", ink4: "#8A8990", accent: "#7CB342", ok: "#4CAF50", info: "#2196F3", warn: "#FF9800", rule: "rgba(14,14,16,0.08)" };

const badges = [
  { code: "EDU", title: "Ph.D. Neuroscience", sub: "UCSF · 2019", issuer: "ORCID", color: C.ink },
  { code: "PUB", title: "34 Publications", sub: "2.8K citations", issuer: "arXiv", color: C.info },
  { code: "REV", title: "Reviewer of Record", sub: "Cell · Nature Neuro", issuer: "Crossref", color: C.accent },
  { code: "AWARD", title: "Sloan Fellow 2022", sub: "Sloan Foundation", issuer: "Verified", color: C.ok },
  { code: "OSS", title: "openbrain Maintainer", sub: "1.2K stars", issuer: "GitHub", color: C.ink },
  { code: "AFFIL", title: "UCSF Asst. Prof", sub: "Neurology Dept", issuer: "UCSF", color: C.info },
  { code: "GRANT", title: "NIH R01 PI", sub: "$420K active", issuer: "NIH", color: C.warn },
  { code: "REPRO", title: "18 Replications", sub: "0 refuted", issuer: "UB-Chain", color: C.ink },
];

export default function BadgesScreen() {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.paper }} contentContainerStyle={{ padding: 16 }}>
      <Text style={{ fontSize: 9, fontFamily: "Courier", letterSpacing: 1.5, color: C.ink4, fontWeight: "600", marginBottom: 4 }}>SOULBOUND CREDENTIALS</Text>
      <Text style={{ fontSize: 12, color: C.ink3, marginBottom: 16 }}>24 soulbound · 8 featured · 0 hidden</Text>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {badges.map((b, i) => (
          <TouchableOpacity key={i} style={{ width: "48.5%", backgroundColor: "#fff", borderWidth: 1, borderColor: C.rule, borderRadius: 10, borderTopWidth: 3, borderTopColor: b.color, padding: 12 }}
            onPress={() => Alert.alert(b.title, `Issuer: ${b.issuer}\nType: ${b.code}\n${b.sub}\n\nSoulbound · Non-transferable`)}>
            <Text style={{ fontSize: 9, fontFamily: "Courier", color: b.color, fontWeight: "700", letterSpacing: 1 }}>{b.code}</Text>
            <Text style={{ fontSize: 13, fontWeight: "600", color: C.ink, marginTop: 6 }}>{b.title}</Text>
            <Text style={{ fontSize: 10, color: C.ink4, marginTop: 2, fontFamily: "Courier" }}>{b.sub}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8 }}>
              <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: C.ok }} />
              <Text style={{ fontSize: 9, color: C.ink4, fontFamily: "Courier" }}>{b.issuer} · VERIFIED</Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity style={{ marginTop: 16, padding: 14, borderWidth: 1, borderStyle: "dashed", borderColor: C.rule, borderRadius: 10, alignItems: "center" }}
        onPress={() => Alert.alert("Request Badge", "Select credential type to request from an issuer")}>
        <Text style={{ fontSize: 12, color: C.accent, fontWeight: "600" }}>+ Request a new badge</Text>
      </TouchableOpacity>
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}
