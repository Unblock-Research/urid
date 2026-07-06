import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from "react-native";
import { StatusBar } from "expo-status-bar";

const C = { paper: "#FBF9F2", ink: "#0E0E10", ink2: "#26252A", ink3: "#5B5A60", ink4: "#8A8990", accent: "#7CB342", ok: "#4CAF50", warn: "#FF9800", rule: "rgba(14,14,16,0.08)" };
const API = "http://localhost:3001/api";

export default function IdentityScreen() {
  return (
    <ScrollView style={s.container} contentContainerStyle={{ padding: 16 }}>
      <StatusBar style="dark" />

      {/* Hero Card */}
      <View style={[s.card, { backgroundColor: C.ink, padding: 20 }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: C.accent, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontSize: 24, fontWeight: "800", color: C.ink }}>M</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: C.paper, fontSize: 18, fontWeight: "700" }}>Dr. Malcolm A. Harriot</Text>
            <Text style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, fontFamily: "Courier", marginTop: 2 }}>@malcolm.harriot</Text>
          </View>
        </View>
        <View style={{ flexDirection: "row", gap: 20, marginTop: 16 }}>
          {[["TIS", "84.2"], ["CITES", "2.8k"], ["REVIEWS", "142"]].map(([l, v]) => (
            <View key={l}>
              <Text style={{ color: "rgba(255,255,255,0.4)", fontSize: 9, fontFamily: "Courier", letterSpacing: 1 }}>{l}</Text>
              <Text style={{ color: C.paper, fontSize: 22, fontWeight: "700", marginTop: 2 }}>{v}</Text>
            </View>
          ))}
        </View>
        <View style={{ marginTop: 14, backgroundColor: "rgba(255,255,255,0.08)", paddingHorizontal: 10, paddingVertical: 6, flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.accent }} />
          <Text style={{ color: "rgba(255,255,255,0.5)", fontSize: 10, fontFamily: "Courier" }}>did:ub:0x4A92F2C3·B8F2A3FC2</Text>
        </View>
      </View>

      {/* Quick Actions */}
      <View style={{ flexDirection: "row", gap: 8, marginTop: 16 }}>
        {[["✓", "Sign-in"], ["↗", "Send"], ["◇", "Prove"], ["⤴", "Share"]].map(([icon, label]) => (
          <TouchableOpacity key={label} style={[s.card, { flex: 1, alignItems: "center", paddingVertical: 14 }]}
            onPress={() => Alert.alert(label, `${label} action triggered`)}>
            <Text style={{ fontSize: 20, marginBottom: 4 }}>{icon}</Text>
            <Text style={{ fontSize: 10, color: C.ink3, fontWeight: "600" }}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Active Right Now */}
      <Text style={[s.label, { marginTop: 20, marginBottom: 8 }]}>ACTIVE RIGHT NOW</Text>
      {[
        { icon: "✦", title: "Sloan Foundation", sub: "2026 Fellow badge ready to accept", time: "12m", color: C.accent },
        { icon: "◆", title: "VitaDAO", sub: "Wants you as reviewer · 80 UBR bounty", time: "2h", color: C.warn },
        { icon: "↻", title: "RIKEN · T. Suzuki", sub: "Replicated tonic GABA result", time: "1d", color: C.ok },
      ].map((e, i) => (
        <TouchableOpacity key={i} style={[s.card, { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, marginBottom: 8 }]}
          onPress={() => Alert.alert(e.title, e.sub)}>
          <Text style={{ fontSize: 18, width: 28, textAlign: "center" }}>{e.icon}</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 13, fontWeight: "600", color: C.ink }}>{e.title}</Text>
            <Text style={{ fontSize: 11, color: C.ink3, marginTop: 1 }}>{e.sub}</Text>
          </View>
          <Text style={{ fontSize: 10, color: C.ink4, fontFamily: "Courier" }}>{e.time}</Text>
        </TouchableOpacity>
      ))}

      {/* Wallet */}
      <View style={[s.card, { marginTop: 12, padding: 16 }]}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <View>
            <Text style={s.label}>WALLET</Text>
            <Text style={{ fontSize: 28, fontWeight: "800", color: C.ink, marginTop: 4 }}>8,420.18 <Text style={{ fontSize: 13, color: C.ink3, fontWeight: "500" }}>UBR</Text></Text>
          </View>
          <Text style={{ fontSize: 11, color: C.ok, fontFamily: "Courier" }}>+412.40 · 7d</Text>
        </View>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
          <TouchableOpacity style={[s.btn, { flex: 1 }]} onPress={() => Alert.alert("Send UBR")}>
            <Text style={s.btnText}>Send</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.btnOutline, { flex: 1 }]} onPress={() => Alert.alert("Receive UBR")}>
            <Text style={[s.btnText, { color: C.ink }]}>Receive</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.paper },
  card: { backgroundColor: "#fff", borderWidth: 1, borderColor: C.rule, borderRadius: 12, padding: 12 },
  label: { fontSize: 9, fontFamily: "Courier", letterSpacing: 1.5, color: C.ink4, fontWeight: "600" },
  btn: { backgroundColor: C.ink, paddingVertical: 10, borderRadius: 8, alignItems: "center" },
  btnOutline: { borderWidth: 1, borderColor: C.rule, paddingVertical: 10, borderRadius: 8, alignItems: "center" },
  btnText: { fontSize: 12, fontWeight: "600", color: "#fff" },
});
