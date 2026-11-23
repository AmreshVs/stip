// The bits of shared/characters.js the app itself needs: names, and what
// each one earns by days with at least one break.
pub const LIST: &[(&str, &str)] = &[
    ("orb", "Orb"),
    ("duck", "Debug Duck"),
    ("coolant", "Coolant"),
    ("camel", "Hump Day"),
    ("gulp", "Gulp"),
    ("spike", "Spike"),
    ("sprout", "Sprout"),
];

fn unlocks(id: &str) -> &'static [(u64, &'static str)] {
    match id {
        "duck" => &[(7, "a hat"), (30, "sunglasses")],
        "coolant" => &[(7, "a heatsink"), (30, "a fan")],
        "camel" => &[(7, "a saddle blanket"), (30, "a second hump")],
        "gulp" => &[(7, "a castle"), (30, "a friend")],
        "spike" => &[(7, "a flower bud"), (30, "flowers that stay")],
        "sprout" => &[(7, "a painted pot"), (30, "a butterfly")],
        _ => &[],
    }
}

pub fn name(id: &str) -> &'static str {
    LIST.iter().find(|(i, _)| *i == id).map(|(_, n)| *n).unwrap_or("Orb")
}

/// The unlock reached by going from one day count to the next, if any.
pub fn unlocked_between(id: &str, before: u64, after: u64) -> Option<&'static str> {
    unlocks(id).iter().find(|(days, _)| before < *days && after >= *days).map(|(_, n)| *n)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unlocks_arrive_once_on_the_day_they_are_earned() {
        assert_eq!(unlocked_between("duck", 6, 7), Some("a hat"));
        assert_eq!(unlocked_between("duck", 7, 8), None);
        assert_eq!(unlocked_between("sprout", 29, 30), Some("a butterfly"));
        assert_eq!(unlocked_between("orb", 6, 7), None);
        assert_eq!(name("camel"), "Hump Day");
    }

    #[test]
    fn matches_the_list_in_characters_js() {
        let js = include_str!("../../src/renderer/shared/characters.js");
        for (id, name) in LIST {
            assert!(js.contains(&format!("{{ id: '{id}', name: '{name}' }}")), "{id}");
            for (days, unlock) in unlocks(id) {
                assert!(js.contains(&format!("[{days}, '{unlock}']")), "{id} {unlock}");
            }
        }
    }
}
