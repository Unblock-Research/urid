import { View, Text, ScrollView, TouchableOpacity, Alert } from "react-native";

const C = { paper: "#FBF9F2", ink: "#0E0E10", ink3: "#5B5A60", ink4: "#8A8990", accent: "#7CB342", ok: "#4CAF50", bad: "#F44336", rule: "rgba(14,14,16,0.08)" };

const txns = [
  { icon: "↓", who: "NIH R01", sub: "Milestone 3 payout", amount: "+4,200.00", time: "2d", color: C.ok },
  { icon: "↓", who: "Cell Reports", sub: "Review reward", amount: "+120.00", time: "3d", color: C.ok },
  { icon: "↑", who: "Compute", sub: "GPU cluster · 4h", amount: "-45.00", time: "4d", color: C.bad },
  { icon: "↓", who: "Patent royalty", sub: "US11,234,567", amount: "+89.40", time: "5d", color: C.ok },
  { icon: "↑", who: "Storage", sub: "2TB IPFS pinning", amount: "-12.00", time: "6d", color: C.bad },
  { icon: "↓", who: "VitaDAO", sub: "Reviewer bounty", amount: "+80.00", time: "1w", color: C.ok },
];

export default function WalletScreen() {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.paper }} contentContainerStyle={{ padding: 16 }}>
      {/* Balance Card */}
      <View style={{ backgroundColor: C.ink, borderRadius: 16, padding: 24, marginBottom: 16 }}>
        <Text style={{ fontSize: 9, fontFamily: "Courier", color: "rgba(255,255,255,0.4)", letterSpacing: 1.5 }}>UB-CHAIN · 0x4A92…3FC2</Text>
        <Text style={{ fontSize: 42, fontWeight: "800", color: "#fff", marginTop: 8 }}>8,420.18</Text>
        <Text style={{ fontSize: 14, color: "rgba(255,255,255,0.5)", marginTop: 2 }}>UBR</Text>
        <Text style={{ fontSize: 12, color: C.ok, fontFamily: "Courier", marginTop: 8 }}>+412.40 · 7d</Text>

        <View style={{ flexDirection: "row", gap: 8, marginTop: 20 }}>
          {[["↗", "Send"], ["↘", "Receive"], ["◆", "Stake"], ["⇄", "Swap"]].map(([icon, label]) => (
            <TouchableOpacity key={label} style={{ flex: 1, backgroundColor: "rgba(255,255,255,0.1)", paddingVertical: 10, borderRadius: 8, alignItems: "center" }}
              onPress={() => Alert.alert(label, `${label} UBR tokens`)}>
              <Text style={{ fontSize: 16, color: "#fff", marginBottom: 2 }}>{icon}</Text>
              <Text style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", fontWeight: "600" }}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Transactions */}
      <Text style={{ fontSize: 9, fontFamily: "Courier", letterSpacing: 1.5, color: C.ink4, fontWeight: "600", marginBottom: 10 }}>ACTIVITY</Text>

      {txns.map((tx, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.rule, gap: 12 }}>
          <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(14,14,16,0.04)", alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontSize: 16 }}>{tx.icon}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 13, fontWeight: "600", color: C.ink }}>{tx.who}</Text>
            <Text style={{ fontSize: 10, color: C.ink4 }}>{tx.sub}</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={{ fontSize: 13, fontWeight: "600", color: tx.color, fontFamily: "Courier" }}>{tx.amount}</Text>
            <Text style={{ fontSize: 9, color: C.ink4, fontFamily: "Courier" }}>{tx.time}</Text>
          </View>
        </View>
      ))}
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}
