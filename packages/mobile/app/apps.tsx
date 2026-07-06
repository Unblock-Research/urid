import { View, Text, ScrollView, TouchableOpacity, Alert, Switch } from "react-native";
import { useState } from "react";

const C = { paper: "#FBF9F2", ink: "#0E0E10", ink3: "#5B5A60", ink4: "#8A8990", accent: "#7CB342", ok: "#4CAF50", warn: "#FF9800", rule: "rgba(14,14,16,0.08)" };

export default function AppsScreen() {
  const [appStates, setAppStates] = useState<Record<string, boolean>>({ labbook: true, publisher: true, swap: true, vitadao: true, orcid: true, arxiv: true, github: true, anthropic: false });

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.paper }} contentContainerStyle={{ padding: 16 }}>
      {/* Incoming ZK Request */}
      <View style={{ backgroundColor: "#fff", borderWidth: 2, borderColor: C.warn, borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <Text style={{ fontSize: 10, fontFamily: "Courier", color: C.warn, fontWeight: "700", letterSpacing: 1 }}>● INCOMING REQUEST</Text>
          <Text style={{ fontSize: 12, fontFamily: "Courier", color: C.warn }}>5:12</Text>
        </View>
        <Text style={{ fontSize: 15, fontWeight: "700", color: C.ink }}>VitaDAO</Text>
        <Text style={{ fontSize: 12, color: C.ink3, marginTop: 4 }}>Is the holder a reviewer of record on Cell/Nature, and TIS ≥ 80?</Text>

        <View style={{ marginTop: 12, gap: 6 }}>
          {[["Reviewer-of-record", "PROVE"], ["TIS ≥ 80", "PROVE"], ["Your name", "HIDDEN"], ["Affiliation", "HIDDEN"]].map(([claim, status]) => (
            <View key={claim} style={{ flexDirection: "row", justifyContent: "space-between", backgroundColor: "rgba(14,14,16,0.03)", paddingHorizontal: 10, paddingVertical: 8, borderRadius: 6 }}>
              <Text style={{ fontSize: 11, color: C.ink }}>{claim}</Text>
              <Text style={{ fontSize: 9, fontFamily: "Courier", color: status === "PROVE" ? C.accent : C.ink4, fontWeight: "600" }}>{status}</Text>
            </View>
          ))}
        </View>

        <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
          <TouchableOpacity style={{ flex: 1, paddingVertical: 10, borderWidth: 1, borderColor: C.rule, borderRadius: 8, alignItems: "center" }}
            onPress={() => Alert.alert("Rejected", "VitaDAO will be notified")}>
            <Text style={{ fontSize: 12, fontWeight: "600", color: C.ink3 }}>Reject</Text>
          </TouchableOpacity>
          <TouchableOpacity style={{ flex: 1, paddingVertical: 10, backgroundColor: C.ink, borderRadius: 8, alignItems: "center" }}
            onPress={() => Alert.alert("Signed", "ZK proof shared for 1 hour\nClaims: Reviewer + TIS≥80\nRecorded on UB-Chain")}>
            <Text style={{ fontSize: 12, fontWeight: "600", color: "#fff" }}>Sign & share for 1h</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Connected Apps */}
      <Text style={{ fontSize: 9, fontFamily: "Courier", letterSpacing: 1.5, color: C.ink4, fontWeight: "600", marginBottom: 10 }}>CONNECTED APPS</Text>

      {Object.entries(appStates).map(([app, on]) => (
        <View key={app} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.rule }}>
          <View>
            <Text style={{ fontSize: 13, fontWeight: "500", color: C.ink, textTransform: "capitalize" }}>{app.replace(/([A-Z])/g, " $1")}</Text>
            <Text style={{ fontSize: 10, color: C.ink4, fontFamily: "Courier" }}>{on ? "ZK proofs active" : "pending consent"}</Text>
          </View>
          <Switch value={on} onValueChange={v => setAppStates({ ...appStates, [app]: v })}
            trackColor={{ false: C.rule, true: C.accent }} thumbColor="#fff" />
        </View>
      ))}
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}
