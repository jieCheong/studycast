exports.up = (pgm) => {
    pgm.createTable("profiles", {
        user_id: {
            type:"uuid",
            primaryKey: true,
            references: "users",
            onDelete: "cascade",
        },
        generation_count: {type: "integer", notNull:true, default: 0},
        created_at: {type: "timestamptz", notNull:true, default:pgm.func("now()")},
        updated_at: {type: "timestamptz", notNull:true, default:pgm.func("now()")},
    });
};

exports.down = (pgm) => {
    pgm.dropTable("profiles");
};
